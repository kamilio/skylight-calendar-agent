import { randomUUID } from "node:crypto";
import { UserError } from "toolcraft";
import { getSkylightRequestConfig } from "./config.js";
import { errorMessage, terminalSafeText, truncateText } from "./text.js";
import { assertBoundedString } from "./validation.js";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const CLIENT_ID = "skylight-mobile";
const SCOPE = "everything";
const REDIRECT_URI = "https://ourskylight.com/welcome";
const MAX_RESPONSE_LENGTH = 20_000;

function oauthDeviceValues(fingerprint: string): Record<string, string> {
  return {
    skylight_api_client_device_fingerprint: fingerprint,
    skylight_api_client_device_platform: "web",
    skylight_api_client_device_name: "unknown",
    skylight_api_client_device_os_version: "10.15.7",
    skylight_api_client_device_app_version: "unknown",
    skylight_api_client_device_hardware: "Macintosh",
    source: "js-mobile",
  };
}

export interface StoredOAuthCredential {
  version: 1;
  type: "oauth";
  accessToken: string;
  refreshToken: string;
  fingerprint: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
}

function excerpt(value: string): string {
  const safe = terminalSafeText(value).trim();
  return safe.length <= 1_000 ? safe : `${truncateText(safe, 1_000)}…`;
}

function responseExcerpt(value: string): string {
  return excerpt(value.slice(0, MAX_RESPONSE_LENGTH));
}

function browserHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("user-agent", BROWSER_USER_AGENT);
  headers.set("accept", BROWSER_ACCEPT);
  return headers;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function csrfToken(html: string): string {
  const match =
    html.match(/name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/i) ??
    html.match(/value=["']([^"']+)["'][^>]*name=["']authenticity_token["']/i);
  if (!match?.[1]) throw new UserError("Skylight login page did not contain a CSRF token.");
  return decodeHtmlAttribute(match[1]);
}

function setCookies(headers: Headers, cookies: Map<string, string>): void {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair?.indexOf("=") ?? -1;
    if (!pair || separator <= 0) continue;
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(cookies: Map<string, string>): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function browserFetch(opts: {
  fetch: typeof globalThis.fetch;
  url: string;
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
  cookies: Map<string, string>;
  signal: AbortSignal;
}): Promise<Response> {
  const headers = browserHeaders(opts.headers);
  const cookie = cookieHeader(opts.cookies);
  if (cookie) headers.set("cookie", cookie);
  const response = await opts.fetch(opts.url, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body === undefined ? {} : { body: opts.body }),
    redirect: "manual",
    signal: opts.signal,
  });
  setCookies(response.headers, opts.cookies);
  return response;
}

function oauthCredential(json: TokenResponse, fingerprint: string): StoredOAuthCredential {
  if (typeof json.access_token !== "string" || json.access_token.length === 0) {
    throw new UserError("Skylight OAuth response did not contain an access token.");
  }
  if (typeof json.refresh_token !== "string" || json.refresh_token.length === 0) {
    throw new UserError("Skylight OAuth response did not contain a refresh token.");
  }
  if (typeof json.expires_in !== "number" || !Number.isFinite(json.expires_in) || json.expires_in <= 0) {
    throw new UserError("Skylight OAuth response did not contain a valid expiration time.");
  }
  assertBoundedString(json.access_token, "OAuth access token");
  assertBoundedString(json.refresh_token, "OAuth refresh token");
  return {
    version: 1,
    type: "oauth",
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    fingerprint,
    expiresAt: Date.now() + Math.floor(json.expires_in * 1_000),
  };
}

async function tokenRequest(opts: {
  fetch: typeof globalThis.fetch;
  apiBaseUrl: string;
  values: URLSearchParams;
  fingerprint: string;
  signal: AbortSignal;
}): Promise<StoredOAuthCredential> {
  const response = await opts.fetch(`${opts.apiBaseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: opts.values,
    signal: opts.signal,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new UserError(
      `Skylight OAuth token request failed (${response.status}). ${responseExcerpt(text) || "Try logging in again."}`
    );
  }
  let json: TokenResponse;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    throw new UserError(`Skylight OAuth response was not valid JSON: ${responseExcerpt(text)}`);
  }
  return oauthCredential(json, opts.fingerprint);
}

export async function loginWithOAuth(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  email: string;
  password: string;
  fingerprint?: string;
}): Promise<StoredOAuthCredential> {
  const env = opts.env ?? process.env;
  const { apiBaseUrl, requestTimeoutMs } = getSkylightRequestConfig(env);
  const fingerprint = opts.fingerprint ?? randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const cookies = new Map<string, string>();
  try {
    const loginPage = await browserFetch({
      fetch: opts.fetch,
      url: `${apiBaseUrl}/auth/session/new`,
      cookies,
      signal: controller.signal,
    });
    const loginHtml = await loginPage.text();
    if (!loginPage.ok) {
      throw new UserError(
        `Could not open Skylight login (${loginPage.status}). ${responseExcerpt(loginHtml)}`
      );
    }

    const form = new URLSearchParams({
      authenticity_token: csrfToken(loginHtml),
      email: opts.email,
      password: opts.password,
    });
    const sessionResponse = await browserFetch({
      fetch: opts.fetch,
      url: `${apiBaseUrl}/auth/session`,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: apiBaseUrl,
        referer: `${apiBaseUrl}/auth/session/new`,
      },
      body: form,
      cookies,
      signal: controller.signal,
    });
    const sessionLocation = sessionResponse.headers.get("location") ?? "";
    if (
      ![200, 302, 303].includes(sessionResponse.status) ||
      new URL(sessionLocation || "/", apiBaseUrl).pathname === "/auth/session/new"
    ) {
      throw new UserError(
        "Skylight rejected the login. Check the email and password, and complete any pending device or two-factor verification in a browser."
      );
    }

    const authorize = new URL(`${apiBaseUrl}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      skylight_api_client_device_fingerprint: fingerprint,
    }).toString();
    const authorizationResponse = await browserFetch({
      fetch: opts.fetch,
      url: authorize.toString(),
      cookies,
      signal: controller.signal,
    });
    const location = authorizationResponse.headers.get("location");
    if (!location) {
      const body = await authorizationResponse.text();
      throw new UserError(
        `Skylight authorization did not return a redirect (${authorizationResponse.status}). ${responseExcerpt(body)}`
      );
    }
    const redirect = new URL(location, apiBaseUrl);
    const code = redirect.searchParams.get("code");
    if (!code) {
      throw new UserError(
        redirect.pathname === "/auth/session/new"
          ? "Skylight rejected the login. Complete any pending device or two-factor verification in a browser."
          : "Skylight authorization redirect did not contain an authorization code."
      );
    }

    return tokenRequest({
      fetch: opts.fetch,
      apiBaseUrl,
      fingerprint,
      signal: controller.signal,
      values: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        ...oauthDeviceValues(fingerprint),
      }),
    });
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (controller.signal.aborted) {
      throw new UserError(`Skylight login timed out after ${requestTimeoutMs}ms.`);
    }
    throw new UserError(`Skylight login failed: ${excerpt(errorMessage(error))}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshOAuthCredential(opts: {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  credential: StoredOAuthCredential;
}): Promise<StoredOAuthCredential> {
  const env = opts.env ?? process.env;
  const { apiBaseUrl, requestTimeoutMs } = getSkylightRequestConfig(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await tokenRequest({
      fetch: opts.fetch,
      apiBaseUrl,
      fingerprint: opts.credential.fingerprint,
      signal: controller.signal,
      values: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: opts.credential.refreshToken,
        client_id: CLIENT_ID,
        ...oauthDeviceValues(opts.credential.fingerprint),
      }),
    });
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (controller.signal.aborted) {
      throw new UserError(`Skylight token refresh timed out after ${requestTimeoutMs}ms.`);
    }
    throw new UserError(`Skylight token refresh failed: ${excerpt(errorMessage(error))}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function serializeOAuthCredential(credential: StoredOAuthCredential): string {
  return JSON.stringify(credential);
}

export function parseOAuthCredential(value: string): StoredOAuthCredential | null {
  if (!value.startsWith("{")) return null;
  let json: unknown;
  try {
    json = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const record = json as Partial<StoredOAuthCredential>;
  if (
    record.version !== 1 ||
    record.type !== "oauth" ||
    typeof record.accessToken !== "string" ||
    typeof record.refreshToken !== "string" ||
    typeof record.fingerprint !== "string" ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt)
  ) {
    return null;
  }
  return record as StoredOAuthCredential;
}
