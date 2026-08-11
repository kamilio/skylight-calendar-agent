import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { S, defineCommand, defineGroup } from "toolcraft";
import { createHTTPMCPServer } from "toolcraft/http";
import { hostedOAuth } from "toolcraft/http/hosted-oauth";
import { deriveOAuthKeyMaterial } from "../dist/skylight/oauth-keys.js";
import { createSkylightOAuthProvider } from "../dist/skylight/oauth-provider.js";
import { SQLiteSkylightOAuthStore } from "../dist/skylight/oauth-sqlite-store.js";

const encodedMasterKey = randomBytes(32).toString("base64url");
const savedTimezone = process.env.SKYLIGHT_TIMEZONE;
process.env.SKYLIGHT_TIMEZONE = "America/Chicago";
const firstKeyMaterial = deriveOAuthKeyMaterial(encodedMasterKey);
const restartedKeyMaterial = deriveOAuthKeyMaterial(encodedMasterKey);
assert.equal(firstKeyMaterial.signingPrivateKey.asymmetricKeyType, "ec");
assert.notDeepEqual(firstKeyMaterial.encryptionKey, firstKeyMaterial.subjectKey);
assert.deepEqual(firstKeyMaterial.encryptionKey, restartedKeyMaterial.encryptionKey);
assert.deepEqual(firstKeyMaterial.subjectKey, restartedKeyMaterial.subjectKey);
assert.deepEqual(
  createPublicKey(firstKeyMaterial.signingPrivateKey).export({ format: "jwk" }),
  createPublicKey(restartedKeyMaterial.signingPrivateKey).export({ format: "jwk" })
);
assert.throws(() => deriveOAuthKeyMaterial("short"), /SKYLIGHT_OAUTH_MASTER_KEY/);

const upstreamRequests = [];
let signedInEmail = "person@example.com";
const upstreamFetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const body = init.body === undefined ? "" : String(init.body);
  upstreamRequests.push({ path: parsed.pathname, body });
  if (parsed.pathname === "/auth/session/new") {
    return new Response(
      '<input type="hidden" name="authenticity_token" value="csrf-token">',
      { headers: { "set-cookie": "session=abc; Path=/; HttpOnly" } }
    );
  }
  if (parsed.pathname === "/auth/session") {
    const form = new URLSearchParams(body);
    if (form.get("password") === "correct horse") {
      signedInEmail = form.get("email") ?? "person@example.com";
      return new Response("", {
        status: 302,
        headers: { location: "/dashboard" },
      });
    }
    return new Response("", {
      status: 302,
      headers: { location: "/auth/session/new" },
    });
  }
  if (parsed.pathname === "/oauth/authorize") {
    return new Response("", {
      status: 302,
      headers: { location: "https://ourskylight.com/welcome?code=upstream-code" },
    });
  }
  if (parsed.pathname === "/oauth/token") {
    const account = signedInEmail === "other@example.com" ? "other" : "person";
    return Response.json({
      access_token: `upstream-access-${account}`,
      refresh_token: `upstream-refresh-${account}`,
      expires_in: 3600,
      token_type: "Bearer",
    });
  }
  if (parsed.pathname === "/api/user") {
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    const account = authorization.endsWith("-other") ? "other" : "person";
    return Response.json({ data: { id: `upstream-user-${account}`, type: "user" } });
  }
  throw new Error(`Unexpected upstream request: ${parsed.pathname}`);
};

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const resource = `${baseUrl}/mcp`;
const storageDirectory = await mkdtemp(
  path.join(tmpdir(), "skylight-oauth-login-")
);
const databasePath = path.join(storageDirectory, "oauth.sqlite");
const createStorage = () =>
  new SQLiteSkylightOAuthStore({
    databasePath,
    ...deriveOAuthKeyMaterial(encodedMasterKey),
  });
let storage = createStorage();
const root = defineGroup({
  name: "smoke",
  children: [
    defineCommand({
      name: "timezone",
      scope: ["mcp"],
      params: S.Object({}),
      handler: ({ skylight }) => skylight.timezone(),
    }),
  ],
});
const createServer = () => createHTTPMCPServer(root, {
  name: "skylight-oauth-smoke",
  version: "1.0.0",
  oauth: hostedOAuth({
    publicUrl: resource,
    storage,
    provider: createSkylightOAuthProvider({
      fetch: upstreamFetch,
      env: {
        SKYLIGHT_API_BASE: "https://skylight.invalid",
        SKYLIGHT_TIMEZONE: "America/Chicago",
      },
    }),
    advanced: { branding: { title: "Skylight Calendar" } },
  }),
});
let handle = await (await createServer()).listenHttp({ hostname: "127.0.0.1", port });
let client;

try {
  const registration = await fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://client.example/callback"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registration.status, 201);
  const { client_id: clientId } = await registration.json();
  const verifier = randomBytes(32).toString("base64url");
  const first = await startAuthorization({ clientId, verifier, state: "smoke-state" });
  const firstNonce = assertLoginUx(first);
  assert.match(first.html, /Connect Skylight Calendar/);
  assert.doesNotMatch(first.html, /one Skylight account/i);

  const rejected = await submitLogin({
    cookie: first.cookie,
    html: first.html,
    email: "person@example.com",
    password: "not-echoed-secret",
  });
  const retryHtml = await rejected.text();
  assert.equal(rejected.status, 400);
  assert.match(retryHtml, /Skylight sign-in failed/);
  const retryNonce = assertLoginUx({
    csp: rejected.headers.get("content-security-policy") ?? "",
    html: retryHtml,
  });
  assert.notEqual(retryNonce, firstNonce);
  assert.match(retryHtml, /class="error" role="alert"/);
  assert.match(retryHtml, /value="person@example\.com"/);
  assert.doesNotMatch(retryHtml, /not-echoed-secret/);

  const completion = await submitLogin({
    cookie: first.cookie,
    html: retryHtml,
    email: "person@example.com",
    password: "correct horse",
  });
  assert.equal(completion.status, 303);
  const callback = new URL(completion.headers.get("location") ?? "");
  assert.equal(callback.origin, "https://client.example");
  assert.equal(callback.pathname, "/callback");
  assert.equal(callback.searchParams.get("state"), "smoke-state");
  assert.equal(callback.searchParams.get("iss"), baseUrl);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const expired = await submitLogin({
    cookie: first.cookie,
    html: retryHtml,
    email: "person@example.com",
    password: "correct horse",
  });
  assert.equal(expired.status, 400);
  assert.match(expired.headers.get("content-type") ?? "", /text\/html/);
  const expiredHtml = await expired.text();
  assert.match(expiredHtml, /Connection expired/);
  assert.match(expiredHtml, /return to the app that started the connection/);
  assert.match(expiredHtml, /click Connect again/);

  const tokenResponse = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: "https://client.example/callback",
      code_verifier: verifier,
      resource,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.deepEqual(new Set(tokens.scope.split(" ")), new Set(["mcp", "offline_access"]));
  assert.equal(typeof tokens.refresh_token, "string");

  await handle.close();
  storage.close();
  storage = createStorage();
  handle = await (await createServer()).listenHttp({ hostname: "127.0.0.1", port });
  let restartedHealth;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      restartedHealth = await fetch(`${baseUrl}/healthz`, {
        headers: { connection: "close" },
      });
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  assert.ok(restartedHealth);
  assert.equal(restartedHealth.status, 200);
  assert.deepEqual(await restartedHealth.json(), { ok: true });

  client = new Client({ name: "skylight-oauth-smoke", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(handle.url), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    })
  );
  const timezone = await client.callTool({ name: "smoke__timezone", arguments: {} });
  assert.equal(timezone.isError, undefined);
  assert.match(JSON.stringify(timezone.content), /America\/Chicago/);

  const other = await startAuthorization({
    clientId,
    verifier: randomBytes(32).toString("base64url"),
    state: "other-state",
  });
  const otherCompletion = await submitLogin({
    cookie: other.cookie,
    html: other.html,
    email: "other@example.com",
    password: "correct horse",
  });
  assert.equal(otherCompletion.status, 303);
  assert.equal(
    new URL(otherCompletion.headers.get("location") ?? "").searchParams.get("state"),
    "other-state"
  );

  const personSubject = await storage.resolveSubject("Skylight", "upstream-user-person");
  const otherSubject = await storage.resolveSubject("Skylight", "upstream-user-other");
  assert.notEqual(personSubject, otherSubject);
  const personCredential = await storage.credentials.get(personSubject);
  const otherCredential = await storage.credentials.get(otherSubject);
  assert.equal(personCredential?.accessToken, "upstream-access-person");
  assert.equal(otherCredential?.accessToken, "upstream-access-other");
  assert.doesNotMatch(
    JSON.stringify([personCredential, otherCredential]),
    /correct horse|person@example\.com|other@example\.com/
  );

  await storage.credentials.delete(personSubject);
  let failedClosed = false;
  try {
    const missing = await client.callTool({ name: "smoke__timezone", arguments: {} });
    failedClosed = missing.isError === true;
  } catch {
    failedClosed = true;
  }
  assert.equal(failedClosed, true);
  assert.equal(
    upstreamRequests.filter(({ path }) => path === "/auth/session").length,
    3
  );
  storage.close();
  const unhealthy = await fetch(`${baseUrl}/healthz`);
  assert.equal(unhealthy.status, 503);
  assert.deepEqual(await unhealthy.json(), { ok: false });
} finally {
  await client?.close();
  await handle.close();
  storage.close();
  await rm(storageDirectory, { recursive: true, force: true });
  if (savedTimezone === undefined) delete process.env.SKYLIGHT_TIMEZONE;
  else process.env.SKYLIGHT_TIMEZONE = savedTimezone;
}

console.log("hosted-oauth-login-isolation-and-callback-ok");

async function startAuthorization({ clientId, verifier, state }) {
  const authorize = new URL(`${baseUrl}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://client.example/callback",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
    state,
  }).toString();
  const response = await fetch(authorize);
  assert.equal(response.status, 200);
  return {
    html: await response.text(),
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    csp: response.headers.get("content-security-policy") ?? "",
  };
}

function submitLogin({ cookie, html, email, password }) {
  return fetch(`${baseUrl}/oauth/connect`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie,
    },
    body: new URLSearchParams({
      transaction: hiddenValue(html, "transaction"),
      csrf: hiddenValue(html, "csrf"),
      email,
      password,
    }),
  });
}

function hiddenValue(html, name) {
  const marker = `name="${name}" value="`;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`Missing hidden ${name} value`);
  const valueStart = start + marker.length;
  const end = html.indexOf('"', valueStart);
  return html.slice(valueStart, end);
}

function assertLoginUx({ csp, html }) {
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'self' https:\/\/client\.example/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
  assert.ok(nonce);
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /role="status" aria-live="polite" hidden/);
  assert.match(html, /Signing in… This may take a moment\./);
  assert.match(html, /Connecting…/);
  return nonce;
}

async function reservePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve an OAuth smoke port.");
  }
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}
