import { createHash } from "node:crypto";
import { UserError } from "toolcraft";
import { getSkylightRequestConfig } from "./config.js";
import {
  systemAuthorizationStore,
  type AuthorizationStore,
} from "./credential-store.js";
import {
  loginWithOAuth,
  parseOAuthCredential,
  refreshOAuthCredential,
  serializeOAuthCredential,
  type StoredOAuthCredential,
} from "./oauth.js";
import { errorMessage, terminalSafeText, truncateText } from "./text.js";
import { assertBoundedString, assertWellFormedUnicode } from "./validation.js";

const MAX_ERROR_BODY_LENGTH = 2_000;
const MAX_CREDENTIAL_LENGTH = 16_384;
const OAUTH_EXPIRY_SKEW_MS = 60_000;
interface LoginState {
  requests: Map<string, Promise<StoredOAuthCredential>>;
  credentials: Map<string, StoredOAuthCredential>;
}

function isUserError(value: unknown): value is UserError {
  try {
    return value instanceof UserError;
  } catch {
    return false;
  }
}

const loginStates = new WeakMap<
  object,
  WeakMap<typeof globalThis.fetch, LoginState>
>();
const storedRefreshes = new WeakMap<
  AuthorizationStore,
  Map<string, Promise<StoredOAuthCredential>>
>();

function defaultAuthorizationStore(useStoredCredentials: boolean): AuthorizationStore | null {
  if (!useStoredCredentials) return null;
  return systemAuthorizationStore();
}

async function refreshStoredOAuth(opts: {
  fetch: typeof globalThis.fetch;
  env: NodeJS.ProcessEnv;
  store: AuthorizationStore;
  credential: StoredOAuthCredential;
}): Promise<StoredOAuthCredential> {
  if (opts.store.refreshOAuthCredential !== undefined) {
    return opts.store.refreshOAuthCredential({
      fetch: opts.fetch,
      env: opts.env,
      credential: opts.credential,
    });
  }
  let byToken = storedRefreshes.get(opts.store);
  if (byToken === undefined) {
    byToken = new Map();
    storedRefreshes.set(opts.store, byToken);
  }
  const existing = byToken.get(opts.credential.refreshToken);
  if (existing !== undefined) return existing;
  const request = refreshOAuthCredential({
    fetch: opts.fetch,
    env: opts.env,
    credential: opts.credential,
  });
  byToken.set(opts.credential.refreshToken, request);
  try {
    const refreshed = await request;
    await opts.store.write(serializeOAuthCredential(refreshed), opts.env);
    return refreshed;
  } finally {
    if (byToken.get(opts.credential.refreshToken) === request) {
      byToken.delete(opts.credential.refreshToken);
    }
  }
}

function loginKey(env: NodeJS.ProcessEnv, email: string, password: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        env.SKYLIGHT_API_BASE,
        env.SKYLIGHT_REQUEST_TIMEOUT_MS,
        email,
        password,
      ])
    )
    .digest("hex");
}

function loginState(
  env: NodeJS.ProcessEnv,
  fetch: typeof globalThis.fetch
): LoginState {
  let byFetch = loginStates.get(env);
  if (byFetch === undefined) {
    byFetch = new WeakMap();
    loginStates.set(env, byFetch);
  }
  let state = byFetch.get(fetch);
  if (state === undefined) {
    state = { requests: new Map(), credentials: new Map() };
    byFetch.set(fetch, state);
  }
  return state;
}

function errorBodyExcerpt(value: string): string {
  const sanitized = terminalSafeText(value);
  if (sanitized.length <= MAX_ERROR_BODY_LENGTH) return sanitized;
  const truncated = truncateText(sanitized, MAX_ERROR_BODY_LENGTH);
  return `${truncated}… [truncated ${sanitized.length - truncated.length} characters]`;
}

function safeCredentialValue(value: string, label: string): string {
  assertWellFormedUnicode(value, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  const normalized = value.trim();
  if (normalized.length > MAX_CREDENTIAL_LENGTH) {
    throw new UserError(`${label} must not exceed ${MAX_CREDENTIAL_LENGTH} characters.`);
  }
  return normalized;
}

function basicToken(value: string, label: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new UserError(`${label} must be a valid base64-encoded user-id/token pair.`);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    throw new UserError(`${label} must be a valid base64-encoded user-id/token pair.`);
  }
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    throw new UserError(`${label} must decode to valid UTF-8 user-id/token values.`);
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0 || separator === decoded.length - 1) {
    throw new UserError(`${label} must encode non-blank user-id/token values separated by a colon.`);
  }
  const id = decoded.slice(0, separator);
  const token = decoded.slice(separator + 1);
  if (
    safeCredentialValue(id, `${label} user id`) !== id ||
    safeCredentialValue(token, `${label} token`) !== token
  ) {
    throw new UserError(`${label} user-id/token values must not have surrounding whitespace.`);
  }
  return value;
}

function bearerToken(value: string, label: string): string {
  if (/\s/.test(value)) {
    throw new UserError(`${label} must not contain whitespace.`);
  }
  if (!/^[A-Za-z0-9\-._~+/]+={0,}$/.test(value)) {
    throw new UserError(`${label} must use valid Bearer token characters.`);
  }
  return value;
}

function authorizationHeader(value: string): string {
  const match = /^(Basic|Bearer) +(\S+)$/i.exec(value);
  if (!match) {
    throw new UserError(
      "SKYLIGHT_AUTH_HEADER must be a complete Basic or Bearer header with no whitespace in the token."
    );
  }
  const scheme = match[1]?.toLowerCase() === "basic" ? "Basic" : "Bearer";
  if (scheme === "Basic") {
    basicToken(match[2] ?? "", "SKYLIGHT_AUTH_HEADER Basic token");
  } else {
    bearerToken(match[2] ?? "", "SKYLIGHT_AUTH_HEADER Bearer token");
  }
  return `${scheme} ${match[2] ?? ""}`;
}

function explicitAuthorization(env: NodeJS.ProcessEnv): {
  authorization: string;
  source: string;
} | null {
  const explicit = env.SKYLIGHT_AUTH_HEADER
    ? safeCredentialValue(env.SKYLIGHT_AUTH_HEADER, "SKYLIGHT_AUTH_HEADER")
    : "";
  if (explicit) {
    return { authorization: authorizationHeader(explicit), source: "SKYLIGHT_AUTH_HEADER" };
  }

  const existing = env.SKYLIGHT_BASIC_TOKEN
    ? safeCredentialValue(env.SKYLIGHT_BASIC_TOKEN, "SKYLIGHT_BASIC_TOKEN")
    : "";
  if (existing) {
    if (/^basic\s/i.test(existing)) {
      throw new UserError(
        "SKYLIGHT_BASIC_TOKEN must contain only the base64 token, without the Basic prefix. Use SKYLIGHT_AUTH_HEADER for a complete header value."
      );
    }
    return {
      authorization: `Basic ${basicToken(existing, "SKYLIGHT_BASIC_TOKEN")}`,
      source: "SKYLIGHT_BASIC_TOKEN",
    };
  }

  const bearer = env.SKYLIGHT_BEARER_TOKEN
    ? safeCredentialValue(env.SKYLIGHT_BEARER_TOKEN, "SKYLIGHT_BEARER_TOKEN")
    : "";
  if (bearer) {
    if (/^bearer\s/i.test(bearer)) {
      throw new UserError(
        "SKYLIGHT_BEARER_TOKEN must contain only the token, without the Bearer prefix. Use SKYLIGHT_AUTH_HEADER for a complete header value."
      );
    }
    return {
      authorization: `Bearer ${bearerToken(bearer, "SKYLIGHT_BEARER_TOKEN")}`,
      source: "SKYLIGHT_BEARER_TOKEN",
    };
  }
  return null;
}

function loginEmail(value: string | undefined): string {
  if (value === undefined) return "";
  assertWellFormedUnicode(value, "SKYLIGHT_EMAIL");
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError("SKYLIGHT_EMAIL must not contain control characters.");
  }
  const email = value.trim();
  if (email.length === 0) return "";
  if (email.length > 320) {
    throw new UserError("SKYLIGHT_EMAIL must not exceed 320 characters.");
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new UserError("SKYLIGHT_EMAIL must be a valid email address.");
  }
  return email;
}

export async function loginWithPassword(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  email: string;
  password: string;
  signal?: AbortSignal;
}): Promise<StoredOAuthCredential> {
  const env = opts.env ?? process.env;
  const email = loginEmail(opts.email);
  if (email.length === 0) throw new UserError("Email must not be blank.");
  if (opts.password.length === 0) throw new UserError("Password must not be blank.");
  assertBoundedString(opts.password, "Password");
  return loginWithOAuth({
    fetch: opts.fetch,
    env,
    email,
    password: opts.password,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
}

export interface AuthorizationStatus {
  configured: boolean;
  source: string | null;
  storage: string | null;
  apiBaseUrl: string;
}

export async function getAuthorizationStatus(opts: {
  env?: NodeJS.ProcessEnv;
  store?: AuthorizationStore | null;
} = {}): Promise<AuthorizationStatus> {
  const env = opts.env ?? process.env;
  const apiBaseUrl = getSkylightRequestConfig(env).apiBaseUrl;
  const explicit = explicitAuthorization(env);
  if (explicit !== null) {
    return { configured: true, source: explicit.source, storage: null, apiBaseUrl };
  }
  const store =
    opts.store === undefined
      ? defaultAuthorizationStore(opts.env === undefined)
      : opts.store;
  const stored = await store?.read(env);
  if (stored && store !== null) {
    const oauth = parseOAuthCredential(stored);
    if (oauth === null) authorizationHeader(safeCredentialValue(stored, "Stored authorization"));
    return {
      configured: true,
      source: oauth === null ? "stored authorization" : "stored OAuth credential",
      storage: store?.name ?? null,
      apiBaseUrl,
    };
  }
  const email = loginEmail(env.SKYLIGHT_EMAIL);
  const password = env.SKYLIGHT_PASSWORD;
  if (email && password !== undefined && password.length > 0) {
    assertBoundedString(password, "SKYLIGHT_PASSWORD");
    return {
      configured: true,
      source: "SKYLIGHT_EMAIL/SKYLIGHT_PASSWORD",
      storage: null,
      apiBaseUrl,
    };
  }
  return {
    configured: false,
    source: null,
    storage: store?.name ?? null,
    apiBaseUrl,
  };
}

export async function getAuthorizationHeader(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  store?: AuthorizationStore | null;
  useStoredCredentials?: boolean;
}): Promise<string> {
  const env = opts.env ?? process.env;
  const explicit = explicitAuthorization(env);
  if (explicit !== null) return explicit.authorization;

  const store =
    opts.store === undefined
      ? defaultAuthorizationStore(
          opts.useStoredCredentials === true ||
            (opts.useStoredCredentials === undefined && opts.env === undefined)
        )
      : opts.store;
  const stored = await store?.read(env);
  if (stored && store !== null) {
    const oauth = parseOAuthCredential(stored);
    if (oauth !== null) {
      const current =
        oauth.expiresAt - OAUTH_EXPIRY_SKEW_MS <= Date.now()
          ? await refreshStoredOAuth({ fetch: opts.fetch, env, store, credential: oauth })
          : oauth;
      return `Bearer ${safeCredentialValue(current.accessToken, "OAuth access token")}`;
    }
    return authorizationHeader(safeCredentialValue(stored, "Stored authorization"));
  }

  const email = loginEmail(env.SKYLIGHT_EMAIL);
  const password = env.SKYLIGHT_PASSWORD;
  if (!email || password === undefined || password.length === 0) {
    throw new UserError(
      "Missing credentials. Run `skylight auth login`, or set SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD (or SKYLIGHT_BASIC_TOKEN / SKYLIGHT_BEARER_TOKEN / SKYLIGHT_AUTH_HEADER)."
    );
  }
  assertBoundedString(password, "SKYLIGHT_PASSWORD");

  const state = loginState(env, opts.fetch);
  const key = loginKey(env, email, password);
  const cachedCredential = state.credentials.get(key);
  if (cachedCredential !== undefined && cachedCredential.expiresAt - OAUTH_EXPIRY_SKEW_MS > Date.now()) {
    return `Bearer ${cachedCredential.accessToken}`;
  }
  const existingLogin = state.requests.get(key);
  if (existingLogin !== undefined) return `Bearer ${(await existingLogin).accessToken}`;

  const loginRequest =
    cachedCredential === undefined
      ? loginWithOAuth({ fetch: opts.fetch, env, email, password })
      : refreshOAuthCredential({ fetch: opts.fetch, env, credential: cachedCredential });
  state.requests.set(key, loginRequest);
  try {
    const credential = await loginRequest;
    state.credentials.set(key, credential);
    return `Bearer ${credential.accessToken}`;
  } finally {
    if (state.requests.get(key) === loginRequest) state.requests.delete(key);
  }
}

export async function refreshAuthorizationHeader(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  rejectedAuthorization?: string;
  store?: AuthorizationStore | null;
  useStoredCredentials?: boolean;
}): Promise<string | null> {
  const env = opts.env ?? process.env;
  if (explicitAuthorization(env) !== null) return null;
  const store =
    opts.store === undefined
      ? defaultAuthorizationStore(
          opts.useStoredCredentials === true ||
            (opts.useStoredCredentials === undefined && opts.env === undefined)
        )
      : opts.store;
  const stored = await store?.read(env);
  if (stored && store !== null) {
    const oauth = parseOAuthCredential(stored);
    if (oauth === null) return null;
    const currentAuthorization = `Bearer ${oauth.accessToken}`;
    if (
      opts.rejectedAuthorization !== undefined &&
      opts.rejectedAuthorization !== currentAuthorization
    ) {
      return currentAuthorization;
    }
    const refreshed = await refreshStoredOAuth({ fetch: opts.fetch, env, store, credential: oauth });
    return `Bearer ${refreshed.accessToken}`;
  }
  const email = loginEmail(env.SKYLIGHT_EMAIL);
  const password = env.SKYLIGHT_PASSWORD;
  if (!email || password === undefined || password.length === 0) return null;
  const state = loginState(env, opts.fetch);
  const key = loginKey(env, email, password);
  const currentCredential = state.credentials.get(key);
  const currentAuthorization =
    currentCredential === undefined ? undefined : `Bearer ${currentCredential.accessToken}`;
  if (
    opts.rejectedAuthorization !== undefined &&
    currentAuthorization !== undefined &&
    currentAuthorization !== opts.rejectedAuthorization
  ) {
    return currentAuthorization;
  }
  state.credentials.delete(key);
  return getAuthorizationHeader({ fetch: opts.fetch, env, store: null });
}
