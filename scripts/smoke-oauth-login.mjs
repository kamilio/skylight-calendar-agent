import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { getAuthorizationHeader, setRuntimeAuthorizationStore } from "../dist/skylight/auth.js";
import { createSkylightOAuthApp } from "../dist/skylight/oauth-app.js";

const upstreamRequests = [];
const upstreamFetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const body = init.body === undefined ? "" : String(init.body);
  upstreamRequests.push({ path: parsed.pathname, body });
  if (parsed.pathname === "/auth/session/new") {
    return new Response('<input type="hidden" name="authenticity_token" value="csrf-token">', {
      headers: { "set-cookie": "session=abc; Path=/; HttpOnly" },
    });
  }
  if (parsed.pathname === "/auth/session") {
    const password = new URLSearchParams(body).get("password");
    return password === "correct horse"
      ? new Response("", { status: 302, headers: { location: "/dashboard" } })
      : new Response("", { status: 302, headers: { location: "/auth/session/new" } });
  }
  if (parsed.pathname === "/oauth/authorize") {
    return new Response("", {
      status: 302,
      headers: { location: "https://ourskylight.com/welcome?code=upstream-code" },
    });
  }
  if (parsed.pathname === "/oauth/token") {
    return Response.json({
      access_token: "upstream-access",
      refresh_token: "upstream-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });
  }
  throw new Error(`Unexpected upstream request: ${parsed.pathname}`);
};

let app;
let printedAuthorizationUrl;
const server = createServer((request, response) => {
  void app.handle(request, response).catch((error) => {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : String(error));
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("OAuth smoke server did not bind");
const baseUrl = `http://127.0.0.1:${address.port}`;
const resource = `${baseUrl}/mcp`;
app = createSkylightOAuthApp({
  publicUrl: new URL(resource),
  fetch: upstreamFetch,
  env: { SKYLIGHT_API_BASE: "https://skylight.invalid" },
  onAuthorizationUrl(url) {
    printedAuthorizationUrl = url;
  },
});

try {
  const registration = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://127.0.0.1/callback"] }),
  });
  if (registration.status !== 201) throw new Error(`OAuth registration failed: ${registration.status}`);
  const { client_id: clientId } = await registration.json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(`${baseUrl}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "http://127.0.0.1/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope: "mcp offline_access",
    state: "smoke-state",
  }).toString();

  let pageResponse = await fetch(authorize);
  if (printedAuthorizationUrl?.href !== authorize.href) {
    throw new Error("OAuth authorization URL was not exposed for CLI display");
  }
  let page = await pageResponse.text();
  let cookie = pageResponse.headers.getSetCookie()[0]?.split(";", 1)[0] ?? "";
  let csrf = hiddenValue(page, "csrf");
  const transactionId = hiddenValue(page, "transaction_id");
  if (!page.includes("Connect your calendar") || !page.includes('autocomplete="current-password"')) {
    throw new Error("OAuth login page did not render the Skylight sign-in experience");
  }

  const rejected = await submitLogin({ cookie, csrf, transactionId, password: "wrong" });
  page = await rejected.text();
  if (rejected.status !== 200 || !page.includes("Skylight sign-in failed") || page.includes('value="wrong"')) {
    throw new Error("Rejected Skylight login was not safely retryable");
  }
  cookie = rejected.headers.getSetCookie()[0]?.split(";", 1)[0] ?? "";
  csrf = hiddenValue(page, "csrf");

  const completion = await submitLogin({ cookie, csrf, transactionId, password: "correct horse" });
  const completionPage = await completion.text();
  if (!completionPage.includes("Skylight connected")) throw new Error("OAuth completion page was not rendered");
  const callbackUrl = new URL(linkHref(completionPage));
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("OAuth completion callback did not contain a code");
  if (!completionPage.includes(`>${code}</code>`)) {
    throw new Error("OAuth completion page did not expose the one-time code for remote CLI login");
  }
  if (completionPage.includes('http-equiv="refresh"')) {
    throw new Error("Remote OAuth completion page redirected the phone to its own loopback interface");
  }
  if (!completionPage.includes("openclaw mcp login skylight --code CODE")) {
    throw new Error("Remote OAuth completion page omitted the OpenClaw CLI instruction");
  }

  const tokenResponse = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: "http://127.0.0.1/callback",
      code_verifier: verifier,
      resource,
    }),
  });
  if (tokenResponse.status !== 200) throw new Error(`OAuth token exchange failed: ${tokenResponse.status}`);
  const tokens = await tokenResponse.json();
  const verified = await app.authorizationServer.verifyAccessToken(tokens.access_token, resource);
  if (!verified.scopes.includes("mcp")) throw new Error("OAuth access token did not include the MCP scope");

  const upstreamAuthorization = await getAuthorizationHeader({
    fetch: upstreamFetch,
    env: { SKYLIGHT_API_BASE: "https://skylight.invalid" },
    useStoredCredentials: true,
  });
  if (upstreamAuthorization !== "Bearer upstream-access") {
    throw new Error("Embedded OAuth login did not install the upstream Skylight credential");
  }
  if (upstreamRequests.filter(({ path }) => path === "/auth/session").length !== 2) {
    throw new Error("OAuth login retry did not make the expected upstream requests");
  }
} finally {
  setRuntimeAuthorizationStore(null);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function submitLogin({ cookie, csrf, transactionId, password }) {
  return fetch(`${baseUrl}/interaction/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
      origin: baseUrl,
    },
    body: new URLSearchParams({
      csrf,
      transaction_id: transactionId,
      email: "person@example.com",
      password,
    }),
  });
}

function hiddenValue(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  if (!match?.[1]) throw new Error(`Missing hidden ${name} value`);
  return match[1].replaceAll("&amp;", "&").replaceAll("&quot;", '"');
}

function linkHref(html) {
  const match = html.match(/<a class="button(?: secondary)?" href="([^"]+)">/);
  if (!match?.[1]) throw new Error("Missing MCP callback link");
  return match[1].replaceAll("&amp;", "&");
}
