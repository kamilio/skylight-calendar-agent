import { UserError } from "toolcraft";
import { getSkylightConfig } from "./config.js";

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

function errorBodyExcerpt(value: string): string {
  if (value.length <= MAX_ERROR_BODY_LENGTH) return value;
  return `${value.slice(0, MAX_ERROR_BODY_LENGTH)}… [truncated ${value.length - MAX_ERROR_BODY_LENGTH} characters]`;
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

export async function getAuthorizationHeader(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const env = opts.env ?? process.env;
  const explicit = env.SKYLIGHT_AUTH_HEADER?.trim();
  if (explicit) {
    return explicit;
  }

  const existing = env.SKYLIGHT_BASIC_TOKEN?.trim();
  if (existing) {
    return `Basic ${existing}`;
  }

  const bearer = env.SKYLIGHT_BEARER_TOKEN?.trim();
  if (bearer) {
    return `Bearer ${bearer}`;
  }

  const email = env.SKYLIGHT_EMAIL?.trim();
  const password = env.SKYLIGHT_PASSWORD?.trim();
  if (!email || !password) {
    throw new UserError(
      "Missing credentials. Set SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD (or SKYLIGHT_BASIC_TOKEN / SKYLIGHT_BEARER_TOKEN / SKYLIGHT_AUTH_HEADER)."
    );
  }

  const { apiBaseUrl, requestTimeoutMs } = getSkylightConfig(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await opts.fetch(`${apiBaseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
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
    if (!id || !token) {
      throw new UserError("Login response missing id/token.");
    }

    const computed = base64(`${id}:${token}`);
    process.env.SKYLIGHT_BASIC_TOKEN = computed;
    return `Basic ${computed}`;
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (controller.signal.aborted) {
      throw new UserError(`Login request timed out after ${requestTimeoutMs}ms.`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new UserError(`Login request failed: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}
