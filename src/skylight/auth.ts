import { UserError } from "toolcraft";
import { getSkylightConfig } from "./config.js";
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
  return JSON.stringify([
    env.SKYLIGHT_API_BASE,
    env.SKYLIGHT_REQUEST_TIMEOUT_MS,
    email,
    password,
  ]);
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
  const trimmed = value.trim();
  assertWellFormedUnicode(trimmed, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  return trimmed;
}

function loginEmail(value: string | undefined): string {
  const email = value?.trim() ?? "";
  if (email.length === 0) return "";
  assertWellFormedUnicode(email, "SKYLIGHT_EMAIL");
  if (/[\u0000-\u001F\u007F-\u009F]/.test(email)) {
    throw new UserError("SKYLIGHT_EMAIL must not contain control characters.");
  }
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
  const { apiBaseUrl, requestTimeoutMs } = getSkylightConfig(opts.env);
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
      throw new UserError("Login response was not valid JSON.");
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

    const computed = base64(`${id.trim()}:${token.trim()}`);
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
    return explicit;
  }

  const existing = env.SKYLIGHT_BASIC_TOKEN
    ? safeCredentialValue(env.SKYLIGHT_BASIC_TOKEN, "SKYLIGHT_BASIC_TOKEN")
    : "";
  if (existing) {
    return `Basic ${existing}`;
  }

  const bearer = env.SKYLIGHT_BEARER_TOKEN
    ? safeCredentialValue(env.SKYLIGHT_BEARER_TOKEN, "SKYLIGHT_BEARER_TOKEN")
    : "";
  if (bearer) {
    return `Bearer ${bearer}`;
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
