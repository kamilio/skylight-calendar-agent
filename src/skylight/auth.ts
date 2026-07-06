import { createHash } from "node:crypto";
import { UserError } from "toolcraft";
import { getSkylightRequestConfig } from "./config.js";
import { terminalSafeText, truncateText } from "./text.js";
import { assertWellFormedUnicode } from "./validation.js";

interface SessionResponse {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      token?: string;
      email?: string;
      subscription_status?: string;
    };
  };
}

const MAX_ERROR_BODY_LENGTH = 2_000;
interface LoginState {
  requests: Map<string, Promise<string>>;
  authorizations: Map<string, string>;
}

const loginStates = new WeakMap<
  object,
  WeakMap<typeof globalThis.fetch, LoginState>
>();

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
    state = { requests: new Map(), authorizations: new Map() };
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

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function safeCredentialValue(value: string, label: string): string {
  assertWellFormedUnicode(value, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  return value.trim();
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
  const match = /^(Basic|Bearer)\s+(\S+)$/i.exec(value);
  if (!match) {
    throw new UserError(
      "SKYLIGHT_AUTH_HEADER must be a complete Basic or Bearer header with no whitespace in the token."
    );
  }
  if (match[1]?.toLowerCase() === "basic") {
    basicToken(match[2] ?? "", "SKYLIGHT_AUTH_HEADER Basic token");
  } else {
    bearerToken(match[2] ?? "", "SKYLIGHT_AUTH_HEADER Bearer token");
  }
  return value;
}

function loginEmail(value: string | undefined): string {
  if (value === undefined) return "";
  assertWellFormedUnicode(value, "SKYLIGHT_EMAIL");
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError("SKYLIGHT_EMAIL must not contain control characters.");
  }
  const email = value.trim();
  if (email.length === 0) return "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new UserError("SKYLIGHT_EMAIL must be a valid email address.");
  }
  return email;
}

async function login(opts: {
  fetch: typeof globalThis.fetch;
  env: NodeJS.ProcessEnv;
  email: string;
  password: string;
}): Promise<string> {
  const { apiBaseUrl, requestTimeoutMs } = getSkylightRequestConfig(opts.env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await opts.fetch(`${apiBaseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email: opts.email, password: opts.password }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      const excerpt = errorBodyExcerpt(text);
      throw new UserError(
        `Login failed (${response.status}). ${excerpt.length > 0 ? excerpt : "Check credentials."}`
      );
    }

    let json: SessionResponse;
    try {
      json = JSON.parse(text) as SessionResponse;
    } catch {
      const excerpt = errorBodyExcerpt(text);
      throw new UserError(
        `Login response was not valid JSON${excerpt.length > 0 ? `: ${excerpt}` : "."}`
      );
    }
    const id = json.data?.id;
    const token = json.data?.attributes?.token;
    if (
      typeof id !== "string" ||
      id.trim().length === 0 ||
      typeof token !== "string" ||
      token.trim().length === 0
    ) {
      throw new UserError("Login response missing valid string id/token values.");
    }

    const normalizedId = safeCredentialValue(id, "Login response id");
    const normalizedToken = safeCredentialValue(token, "Login response token");

    const computed = base64(`${normalizedId}:${normalizedToken}`);
    return `Basic ${computed}`;
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (controller.signal.aborted) {
      throw new UserError(`Login request timed out after ${requestTimeoutMs}ms.`);
    }
    const detail = errorBodyExcerpt(error instanceof Error ? error.message : String(error));
    throw new UserError(`Login request failed: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAuthorizationHeader(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const env = opts.env ?? process.env;
  const explicit = env.SKYLIGHT_AUTH_HEADER
    ? safeCredentialValue(env.SKYLIGHT_AUTH_HEADER, "SKYLIGHT_AUTH_HEADER")
    : "";
  if (explicit) {
    return authorizationHeader(explicit);
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
    return `Basic ${basicToken(existing, "SKYLIGHT_BASIC_TOKEN")}`;
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
    return `Bearer ${bearerToken(bearer, "SKYLIGHT_BEARER_TOKEN")}`;
  }

  const email = loginEmail(env.SKYLIGHT_EMAIL);
  const password = env.SKYLIGHT_PASSWORD;
  if (!email || password === undefined || password.length === 0) {
    throw new UserError(
      "Missing credentials. Set SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD (or SKYLIGHT_BASIC_TOKEN / SKYLIGHT_BEARER_TOKEN / SKYLIGHT_AUTH_HEADER)."
    );
  }
  assertWellFormedUnicode(password, "SKYLIGHT_PASSWORD");

  const state = loginState(env, opts.fetch);
  const key = loginKey(env, email, password);
  const cachedAuthorization = state.authorizations.get(key);
  if (cachedAuthorization !== undefined) return cachedAuthorization;
  const existingLogin = state.requests.get(key);
  if (existingLogin !== undefined) return existingLogin;

  const loginRequest = login({ fetch: opts.fetch, env, email, password });
  state.requests.set(key, loginRequest);
  try {
    const authorization = await loginRequest;
    state.authorizations.set(key, authorization);
    return authorization;
  } finally {
    if (state.requests.get(key) === loginRequest) state.requests.delete(key);
  }
}

export async function refreshAuthorizationHeader(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  rejectedAuthorization?: string;
}): Promise<string | null> {
  const env = opts.env ?? process.env;
  if (
    env.SKYLIGHT_AUTH_HEADER?.trim() ||
    env.SKYLIGHT_BASIC_TOKEN?.trim() ||
    env.SKYLIGHT_BEARER_TOKEN?.trim()
  ) {
    return null;
  }
  const email = loginEmail(env.SKYLIGHT_EMAIL);
  const password = env.SKYLIGHT_PASSWORD;
  if (!email || password === undefined || password.length === 0) return null;
  const state = loginState(env, opts.fetch);
  const key = loginKey(env, email, password);
  const currentAuthorization = state.authorizations.get(key);
  if (
    opts.rejectedAuthorization !== undefined &&
    currentAuthorization !== undefined &&
    currentAuthorization !== opts.rejectedAuthorization
  ) {
    return currentAuthorization;
  }
  state.authorizations.delete(key);
  return getAuthorizationHeader({ fetch: opts.fetch, env });
}
