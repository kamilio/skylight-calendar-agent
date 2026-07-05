import { UserError } from "toolcraft";
import { getSkylightConfig } from "./config.js";
import { getAuthorizationHeader } from "./auth.js";

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

  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }

  const response = await opts.fetch(url.toString(), init);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new UserError(
      `Request failed (${response.status}) ${opts.method} ${opts.path}${
        text.length > 0 ? `: ${text}` : ""
      }`
    );
  }

  return (await response.json()) as TResponse;
}
