import { createSkylightOAuthProvider } from "../dist/skylight/oauth-provider.js";

const env = {
  SKYLIGHT_API_BASE: "https://skylight.example",
  SKYLIGHT_API_VERSION: "2026-05-01",
  SKYLIGHT_REQUEST_TIMEOUT_MS: "5000",
};
const calls = [];
let refreshRequests = 0;

const fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  calls.push({
    method: init.method ?? "GET",
    path: url.pathname,
    authorization: headers.get("authorization"),
  });

  if (url.pathname === "/auth/session/new") {
    return new Response(
      '<input name="authenticity_token" value="provider-csrf">'
    );
  }
  if (url.pathname === "/auth/session") {
    return new Response(null, {
      status: 302,
      headers: { location: "https://skylight.example/" },
    });
  }
  if (url.pathname === "/oauth/authorize") {
    return new Response(null, {
      status: 302,
      headers: {
        location: "https://ourskylight.com/welcome?code=provider-code",
      },
    });
  }
  if (url.pathname === "/oauth/token") {
    const form = new URLSearchParams(String(init.body));
    if (form.get("grant_type") === "refresh_token") {
      refreshRequests += 1;
      return Response.json({
        access_token: "refreshed-access",
        refresh_token: "refreshed-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    return Response.json({
      access_token: "login-access",
      refresh_token: "login-refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });
  }
  if (url.pathname === "/api/user") {
    if (headers.get("authorization") !== "Bearer login-access") {
      throw new Error("Provider account lookup did not use the login credential.");
    }
    return Response.json({ data: { id: 42 } });
  }
  if (url.pathname === "/api/provider-smoke") {
    return Response.json({ authorization: headers.get("authorization") });
  }
  throw new Error(`Unexpected provider smoke request: ${url}`);
};

const provider = createSkylightOAuthProvider({ fetch, env });
if (provider.name !== "Skylight") {
  throw new Error("The durable provider protocol name changed.");
}
if (provider.connect === undefined) {
  throw new Error("Skylight hosted OAuth provider has no form connector.");
}

let connected;
try {
  connected = await provider.connect({
    email: "person@example.com",
    password: "secret",
    signal: new AbortController().signal,
  });
} catch (error) {
  throw new Error(
    `Provider connection failed after ${JSON.stringify(calls)}: ${String(error)}`
  );
}
if (connected.accountId !== "42") {
  throw new Error(`Unexpected stable Skylight account id: ${connected.accountId}`);
}
if (
  connected.credential.accessToken !== "login-access" ||
  connected.credential.refreshToken !== "login-refresh"
) {
  throw new Error("Skylight provider did not return the login credential.");
}

let credential = {
  ...connected.credential,
  accessToken: "expired-access",
  refreshToken: "rotating-refresh",
  expiresAt: 0,
};
let updateTail = Promise.resolve();
let updateCalls = 0;
let reads = 0;
let releaseReads;
const bothReads = new Promise((resolve) => {
  releaseReads = resolve;
});
const credentials = {
  async read() {
    reads += 1;
    if (reads === 2) releaseReads();
    if (reads <= 2) await bothReads;
    return credential;
  },
  async update(update) {
    updateCalls += 1;
    const operation = updateTail.then(async () => {
      credential = await update(credential);
      return credential;
    });
    updateTail = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  },
  async delete() {
    throw new Error("Unexpected credential deletion.");
  },
};
const identity = {
  issuer: "https://skylight-calendar.example",
  subject: "opaque-subject",
  clientId: "chatgpt",
  scopes: ["mcp", "offline_access"],
  resource: "https://skylight-calendar.example/mcp",
};
const services = await provider.services({ credentials, identity });
if (services.skylight === undefined) {
  throw new Error("Skylight provider did not create request services.");
}
const results = await Promise.all([
  services.skylight.request({
    fetch,
    method: "GET",
    path: "/api/provider-smoke",
  }),
  services.skylight.request({
    fetch,
    method: "GET",
    path: "/api/provider-smoke",
  }),
]);
if (
  results.some(
    (result) => result.authorization !== "Bearer refreshed-access"
  )
) {
  throw new Error(`Hosted requests used stale credentials: ${JSON.stringify(results)}`);
}
if (updateCalls !== 2 || refreshRequests !== 1) {
  throw new Error(
    `Rotating refresh was not coordinated: ${updateCalls} updates, ${refreshRequests} refreshes.`
  );
}

const missingServices = await provider.services({
  identity: { ...identity, subject: "missing-subject" },
  credentials: {
    async read() {
      throw new Error("Provider credential is missing; reconnect required.");
    },
    async update() {
      throw new Error("Provider credential is missing; reconnect required.");
    },
    async delete() {},
  },
});
try {
  await missingServices.skylight.request({
    fetch,
    method: "GET",
    path: "/api/provider-smoke",
  });
  throw new Error("Missing hosted credentials unexpectedly fell back to global auth.");
} catch (error) {
  if (!String(error).includes("Provider credential is missing")) throw error;
}

console.log("oauth-provider-smoke-ok");
