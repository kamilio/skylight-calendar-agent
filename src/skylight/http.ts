import { UserError } from "toolcraft";
import { getSkylightConfig } from "./config.js";
import { getAuthorizationHeader } from "./auth.js";

const MAX_ERROR_BODY_LENGTH = 2_000;

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
  if (value.length <= MAX_ERROR_BODY_LENGTH) return value;
  return `${value.slice(0, MAX_ERROR_BODY_LENGTH)}… [truncated ${value.length - MAX_ERROR_BODY_LENGTH} characters]`;
}

export async function requestJson<TResponse>(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
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
  const config = getSkylightConfig(env);
  let serializedBody: string | undefined;
  if (opts.body !== undefined) {
    try {
      serializedBody = JSON.stringify(opts.body);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new UserError(`Request body is not JSON-serializable for ${opts.method} ${opts.path}: ${detail}`);
    }
    if (serializedBody === undefined) {
      throw new UserError(`Request body is not JSON-serializable for ${opts.method} ${opts.path}.`);
    }
  }

  const url = new URL(`${config.apiBaseUrl}${opts.path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  const auth = await getAuthorizationHeader({ fetch: opts.fetch, env });
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: auth,
    "Skylight-Api-Version": config.apiVersion,
  };

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
    const response = await opts.fetch(url.toString(), init);
    const text = await response.text();

    if (!response.ok) {
      const excerpt = errorBodyExcerpt(text);
      throw new SkylightRequestError(
        response.status,
        opts.method,
        opts.path,
        `Request failed (${response.status}) ${opts.method} ${opts.path}${
          excerpt.length > 0 ? `: ${excerpt}` : ""
        }`
      );
    }

    if (text.trim().length === 0) {
      return null as TResponse;
    }

    try {
      return JSON.parse(text) as TResponse;
    } catch {
      throw new UserError(
        `Invalid JSON response (${response.status}) ${opts.method} ${opts.path}`
      );
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (controller.signal.aborted) {
      throw new UserError(
        `Request timed out after ${config.requestTimeoutMs}ms ${opts.method} ${opts.path}`
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new UserError(`Request failed ${opts.method} ${opts.path}: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}
