import {
  getAuthorizationHeader,
  getAuthorizationStatus,
  loginWithPassword,
  refreshAuthorizationHeader,
} from "../dist/skylight/auth.js";
import {
  completeBrowserOAuthLogin,
  createBrowserOAuthLogin,
  parseOAuthCredential,
  serializeOAuthCredential,
} from "../dist/skylight/oauth.js";

const apiBase = "https://example.invalid";
const env = { SKYLIGHT_API_BASE: apiBase };
const oauth = {
  version: 1,
  type: "oauth",
  accessToken: "stored-access",
  refreshToken: "stored-refresh",
  fingerprint: "11111111-1111-4111-8111-111111111111",
  expiresAt: Date.now() + 3_600_000,
};

const browserLogin = createBrowserOAuthLogin({
  env,
  fingerprint: "22222222-2222-4222-8222-222222222222",
});
const browserLoginUrl = new URL(browserLogin.loginUrl);
if (
  browserLoginUrl.origin !== apiBase ||
  browserLoginUrl.pathname !== "/oauth/authorize" ||
  browserLoginUrl.searchParams.get("client_id") !== "skylight-mobile" ||
  browserLoginUrl.searchParams.get("state") !== "22222222-2222-4222-8222-222222222222" ||
  browserLoginUrl.searchParams.get("skylight_api_client_device_fingerprint") !== "22222222-2222-4222-8222-222222222222"
) {
  throw new Error(`Browser OAuth login URL was incorrect: ${browserLogin.loginUrl}`);
}
let completionBody = "";
const browserCredential = await completeBrowserOAuthLogin({
  env,
  callbackUrl: "https://ourskylight.com/welcome?code=browser-code&state=22222222-2222-4222-8222-222222222222",
  fetch: async (url, init) => {
    if (String(url) !== `${apiBase}/oauth/token`) throw new Error(`Unexpected completion URL ${url}`);
    completionBody = String(init?.body);
    return Response.json({
      access_token: "browser-access",
      refresh_token: "browser-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });
  },
});
if (
  browserCredential.accessToken !== "browser-access" ||
  browserCredential.fingerprint !== "22222222-2222-4222-8222-222222222222" ||
  !completionBody.includes("code=browser-code") ||
  !completionBody.includes("skylight_api_client_device_fingerprint=22222222-2222-4222-8222-222222222222")
) {
  throw new Error("Browser OAuth completion did not exchange the callback correctly");
}
try {
  await completeBrowserOAuthLogin({
    env,
    callbackUrl: "https://example.com/welcome?code=x&state=y",
    fetch: globalThis.fetch,
  });
  throw new Error("Foreign OAuth callback URL unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("https://ourskylight.com/welcome")) throw error;
}

let storedReads = 0;
const legacyStore = {
  name: "Test credential store",
  async read() {
    storedReads += 1;
    return "Bearer stored-token";
  },
  async write() {},
  async delete() { return true; },
};
if (
  (await getAuthorizationHeader({
    fetch: async () => { throw new Error("unexpected fetch"); },
    env,
    store: legacyStore,
  })) !== "Bearer stored-token"
) {
  throw new Error("Legacy stored authorization was not used");
}
if (
  (await getAuthorizationHeader({
    fetch: globalThis.fetch,
    env: { ...env, SKYLIGHT_AUTH_HEADER: "Bearer explicit-token" },
    store: legacyStore,
  })) !== "Bearer explicit-token" ||
  storedReads !== 1
) {
  throw new Error("Environment authorization did not override storage");
}

const status = await getAuthorizationStatus({ env, store: legacyStore });
if (!status.configured || status.source !== "stored authorization") {
  throw new Error(`Legacy status was incorrect: ${JSON.stringify(status)}`);
}

let oauthValue = serializeOAuthCredential(oauth);
let oauthWrites = 0;
const oauthStore = {
  name: "Test OAuth store",
  async read() { return oauthValue; },
  async write(value) { oauthWrites += 1; oauthValue = value; },
  async delete() { return true; },
};
if (
  (await getAuthorizationHeader({
    fetch: async () => { throw new Error("unexpired OAuth credential refreshed"); },
    env,
    store: oauthStore,
  })) !== "Bearer stored-access"
) {
  throw new Error("Stored OAuth access token was not used");
}
const oauthStatus = await getAuthorizationStatus({ env, store: oauthStore });
if (!oauthStatus.configured || oauthStatus.source !== "stored OAuth credential") {
  throw new Error(`OAuth status was incorrect: ${JSON.stringify(oauthStatus)}`);
}

const refreshCalls = [];
oauthValue = serializeOAuthCredential({ ...oauth, expiresAt: Date.now() - 1 });
const refreshedHeader = await getAuthorizationHeader({
  env,
  store: oauthStore,
  fetch: async (url, init) => {
    refreshCalls.push({ url: String(url), body: String(init?.body) });
    return Response.json({
      access_token: "refreshed-access",
      refresh_token: "rotated-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });
  },
});
if (
  refreshedHeader !== "Bearer refreshed-access" ||
  oauthWrites !== 1 ||
  refreshCalls[0]?.url !== `${apiBase}/oauth/token` ||
  !refreshCalls[0]?.body.includes("grant_type=refresh_token") ||
  parseOAuthCredential(oauthValue)?.refreshToken !== "rotated-refresh"
) {
  throw new Error("Expired OAuth credential did not refresh and rotate safely");
}

const forcedRefresh = await refreshAuthorizationHeader({
  env,
  store: oauthStore,
  rejectedAuthorization: "Bearer refreshed-access",
  fetch: async () => Response.json({
    access_token: "retry-access",
    refresh_token: "retry-refresh",
    expires_in: 3600,
    token_type: "Bearer",
  }),
});
if (forcedRefresh !== "Bearer retry-access" || parseOAuthCredential(oauthValue)?.refreshToken !== "retry-refresh") {
  throw new Error("Rejected OAuth access token was not refreshed");
}

const loginRequests = [];
const loginFetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  loginRequests.push({
    path: parsed.pathname,
    query: parsed.searchParams,
    method: init.method ?? "GET",
    headers: new Headers(init.headers),
    body: init.body === undefined ? "" : String(init.body),
    redirect: init.redirect,
  });
  if (parsed.pathname === "/auth/session/new") {
    return new Response('<input type="hidden" name="authenticity_token" value="csrf&amp;token">', {
      headers: { "set-cookie": "session_cookie=abc; Path=/; HttpOnly" },
    });
  }
  if (parsed.pathname === "/auth/session") {
    return new Response("", { status: 302, headers: { location: "/dashboard" } });
  }
  if (parsed.pathname === "/oauth/authorize") {
    return new Response("", {
      status: 302,
      headers: { location: "https://ourskylight.com/welcome?code=authorization-code" },
    });
  }
  if (parsed.pathname === "/oauth/token") {
    return Response.json({
      access_token: "login-access",
      refresh_token: "login-refresh",
      expires_in: 7200,
      token_type: "Bearer",
    });
  }
  throw new Error(`Unexpected OAuth request ${parsed.pathname}`);
};
const credential = await loginWithPassword({
  fetch: loginFetch,
  env,
  email: "person@example.com",
  password: " secret ",
});
const sessionRequest = loginRequests.find((request) => request.path === "/auth/session");
const authorizeRequest = loginRequests.find((request) => request.path === "/oauth/authorize");
const tokenRequest = loginRequests.find((request) => request.path === "/oauth/token");
if (
  credential.accessToken !== "login-access" ||
  credential.refreshToken !== "login-refresh" ||
  !sessionRequest?.body.includes("password=+secret+") ||
  !sessionRequest?.body.includes("authenticity_token=csrf%26token") ||
  sessionRequest.headers.get("cookie") !== "session_cookie=abc" ||
  sessionRequest.redirect !== "manual" ||
  authorizeRequest?.query.get("client_id") !== "skylight-mobile" ||
  authorizeRequest?.query.get("skylight_api_client_device_fingerprint") !== credential.fingerprint ||
  !tokenRequest?.body.includes("grant_type=authorization_code") ||
  !tokenRequest?.body.includes("code=authorization-code") ||
  !tokenRequest?.body.includes("skylight_api_client_device_platform=web") ||
  !tokenRequest?.body.includes("skylight_api_client_device_hardware=Macintosh") ||
  !tokenRequest?.body.includes("source=js-mobile")
) {
  throw new Error(`OAuth login flow was incorrect: ${JSON.stringify(loginRequests.map(({ path, method, body }) => ({ path, method, body })))}`);
}

for (const [name, value, expected] of [
  ["SKYLIGHT_AUTH_HEADER", "Bearer good\nInjected: x", "must not contain control characters"],
  ["SKYLIGHT_BASIC_TOKEN", "Basic abc", "without the Basic prefix"],
  ["SKYLIGHT_BEARER_TOKEN", "Bearer abc", "without the Bearer prefix"],
  ["SKYLIGHT_AUTH_HEADER", "abc", "complete Basic or Bearer header"],
  ["SKYLIGHT_BEARER_TOKEN", "abc def", "must not contain whitespace"],
]) {
  try {
    await getAuthorizationHeader({ fetch: globalThis.fetch, env: { [name]: value } });
    throw new Error(`${name} validation unexpectedly succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw error;
  }
}

let oversizedPasswordCalls = 0;
try {
  await loginWithPassword({
    fetch: async () => { oversizedPasswordCalls += 1; return new Response(); },
    env,
    email: "person@example.com",
    password: "p".repeat(8_193),
  });
  throw new Error("Oversized password unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Password must not exceed 8192 characters") || oversizedPasswordCalls !== 0) throw error;
}

try {
  await loginWithPassword({
    fetch: async () => new Response("missing", { status: 500 }),
    env,
    email: "person@example.com",
    password: "secret",
  });
  throw new Error("Failed login-page request unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Could not open Skylight login (500)")) throw error;
}

try {
  await loginWithPassword({
    fetch: async () => new Response("<html></html>"),
    env,
    email: "person@example.com",
    password: "secret",
  });
  throw new Error("Missing CSRF token unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("did not contain a CSRF token")) throw error;
}
