import { UserError } from "toolcraft";
import { getSkylightRequestConfig } from "./config.js";
import { getAuthorizationHeader, refreshAuthorizationHeader } from "./auth.js";
import { terminalSafeText, truncateText } from "./text.js";
import { assertJsonCompatible, assertWellFormedUnicode } from "./validation.js";

const MAX_ERROR_BODY_LENGTH = 2_000;
const MAX_RESPONSE_JSON_DEPTH = 100;

export class SkylightRequestError extends UserError {
  readonly status: number;
  readonly method: string;
  readonly path: string;

  constructor(status: number, method: string, path: string, message: string) {
    super(message);
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

function errorBodyExcerpt(value: string): string {
  const sanitized = terminalSafeText(value);
  if (sanitized.length <= MAX_ERROR_BODY_LENGTH) return sanitized;
  const truncated = truncateText(sanitized, MAX_ERROR_BODY_LENGTH);
  return `${truncated}… [truncated ${sanitized.length - truncated.length} characters]`;
}

function safeOutputText(value: string): string {
  assertWellFormedUnicode(value, "Response JSON string");
  return terminalSafeText(value, true);
}

function retryAfterHint(response: Response): string {
  if (response.status !== 429 && response.status !== 503) return "";
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter === null || retryAfter.trim().length === 0) return "";
  const safeRetryAfter = terminalSafeText(retryAfter).trim();
  return safeRetryAfter.length === 0 ? "" : ` Retry after ${safeRetryAfter}.`;
}

function requestContextMessage(message: string, method: string, path: string): string {
  return `${message} Request: ${method} ${path}.`;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_RESPONSE_JSON_DEPTH) {
    throw new UserError(
      `Response JSON exceeds the maximum nesting depth of ${MAX_RESPONSE_JSON_DEPTH}.`
    );
  }
  if (typeof value === "string") return safeOutputText(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new UserError("Response JSON contains a non-finite number.");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new UserError(
        "Response JSON contains an unsafe integer; the server must encode it as a string to preserve it exactly."
      );
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((child) => sanitizeJsonValue(child, depth + 1));
  if (value === null || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    assertWellFormedUnicode(key, "Response JSON property name");
    const safeKey = terminalSafeText(key);
    if (Object.prototype.hasOwnProperty.call(sanitized, safeKey)) {
      throw new UserError("Response contained duplicate keys after terminal sanitization.");
    }
    Object.defineProperty(sanitized, safeKey, {
      value: sanitizeJsonValue(child, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return sanitized;
}

function serializeJsonBody(value: unknown): string | undefined {
  assertJsonCompatible(value, "Request body");
  return JSON.stringify(value, (key, child) => {
    const location = key.length === 0 ? "the root value" : `property ${JSON.stringify(key)}`;
    if (key.length > 0) assertWellFormedUnicode(key, "Request body property name");
    if (typeof child === "string") assertWellFormedUnicode(child, `Request body ${location}`);
    if (typeof child === "number" && !Number.isFinite(child)) {
      throw new UserError(`Request body contains a non-finite number at ${location}.`);
    }
    if (typeof child === "number" && Number.isInteger(child) && !Number.isSafeInteger(child)) {
      throw new UserError(
        `Request body contains an unsafe integer at ${location}; use a string to preserve it exactly.`
      );
    }
    if (
      child === undefined ||
      typeof child === "function" ||
      typeof child === "symbol" ||
      typeof child === "bigint"
    ) {
      throw new UserError(`Request body contains a non-JSON value at ${location}.`);
    }
    return child;
  });
}

export async function requestJson<TResponse>(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  authenticated?: boolean;
  query?: Record<
    string,
    | string
    | number
    | boolean
    | undefined
    | null
    | ReadonlyArray<string | number | boolean>
  >;
  body?: unknown;
}): Promise<TResponse> {
  const env = opts.env ?? process.env;
  const config = getSkylightRequestConfig(env);
  let serializedBody: string | undefined;
  if (opts.body !== undefined) {
    try {
      serializedBody = serializeJsonBody(opts.body);
    } catch (error) {
      const detail = errorBodyExcerpt(error instanceof Error ? error.message : String(error));
      throw new UserError(`Request body is not JSON-serializable for ${opts.method} ${opts.path}: ${detail}`);
    }
    if (serializedBody === undefined) {
      throw new UserError(`Request body is not JSON-serializable for ${opts.method} ${opts.path}.`);
    }
  }

  const url = new URL(`${config.apiBaseUrl}${opts.path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    assertWellFormedUnicode(key, "Query parameter name");
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = String(item);
        assertWellFormedUnicode(text, `Query parameter ${JSON.stringify(key)}`);
        url.searchParams.append(key, text);
      }
      continue;
    }
    const text = String(value);
    assertWellFormedUnicode(text, `Query parameter ${JSON.stringify(key)}`);
    url.searchParams.set(key, text);
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "Skylight-Api-Version": config.apiVersion,
  };
  if (opts.authenticated !== false) {
    try {
      headers.authorization = await getAuthorizationHeader({ fetch: opts.fetch, env });
    } catch (error) {
      if (error instanceof UserError) {
        throw new UserError(requestContextMessage(error.message, opts.method, opts.path));
      }
      throw error;
    }
  }

  const init: RequestInit = {
    method: opts.method,
    headers,
  };

  if (serializedBody !== undefined) {
    headers["content-type"] = "application/json";
    init.body = serializedBody;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  init.signal = controller.signal;
  try {
    let response = await opts.fetch(url.toString(), init);
    let text = await response.text();

    if (response.status === 401 && opts.authenticated !== false) {
      let refreshedAuthorization: string | null;
      try {
        refreshedAuthorization = await refreshAuthorizationHeader({
          fetch: opts.fetch,
          env,
          ...(headers.authorization === undefined
            ? {}
            : { rejectedAuthorization: headers.authorization }),
        });
      } catch (error) {
        if (error instanceof UserError) {
          throw new UserError(requestContextMessage(error.message, opts.method, opts.path));
        }
        throw error;
      }
      if (refreshedAuthorization !== null) {
        headers.authorization = refreshedAuthorization;
        response = await opts.fetch(url.toString(), init);
        text = await response.text();
      }
    }

    if (!response.ok) {
      const excerpt = errorBodyExcerpt(text);
      const authenticationHint =
        response.status === 401 && opts.authenticated !== false
          ? " Authentication was rejected; check the configured Skylight credentials or token. Explicit auth header and token variables take precedence over email/password login."
          : "";
      const retryHint = retryAfterHint(response);
      throw new SkylightRequestError(
        response.status,
        opts.method,
        opts.path,
        `Request failed (${response.status}) ${opts.method} ${opts.path}${
          excerpt.length > 0 ? `: ${excerpt}` : ""
        }.${authenticationHint}${retryHint}`
      );
    }

    if (text.trim().length === 0) {
      return null as TResponse;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const excerpt = errorBodyExcerpt(text);
      throw new UserError(
        `Invalid JSON response (${response.status}) ${opts.method} ${opts.path}${
          excerpt.length > 0 ? `: ${excerpt}` : ""
        }`
      );
    }
    try {
      return sanitizeJsonValue(parsed) as TResponse;
    } catch (error) {
      if (error instanceof UserError) {
        throw new UserError(requestContextMessage(error.message, opts.method, opts.path));
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (controller.signal.aborted) {
      throw new UserError(
        `Request timed out after ${config.requestTimeoutMs}ms ${opts.method} ${opts.path}`
      );
    }
    const detail = errorBodyExcerpt(error instanceof Error ? error.message : String(error));
    throw new UserError(`Request failed ${opts.method} ${opts.path}: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}
