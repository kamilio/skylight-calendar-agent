import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token = randomBytes(32).toString("base64url");
const expectStartupFailure = async (args, expectedMessage, env = {}) => {
  const processUnderTest = spawn(process.execPath, ["dist/http-mcp.js", ...args], {
    env: { ...process.env, SKYLIGHT_MCP_HTTP_TOKEN: token, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  processUnderTest.stderr.setEncoding("utf8");
  processUnderTest.stderr.on("data", (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      processUnderTest.kill("SIGKILL");
      reject(new Error(`Unsafe HTTP MCP startup did not exit: ${args.join(" ")}`));
    }, 5_000);
    processUnderTest.on("error", reject);
    processUnderTest.on("exit", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
  if (code === 0 || !output.includes(expectedMessage)) {
    throw new Error(`Unexpected startup result for ${args.join(" ")}: ${code} ${output}`);
  }
};

await expectStartupFailure(
  ["--hostname", "0.0.0.0"],
  "requires an https --public-url"
);
await expectStartupFailure(
  ["--hostname", "0.0.0.0", "--public-url", "https://mcp.example/mcp", "--insecure-no-auth"],
  "allowed only on loopback"
);
await expectStartupFailure(
  ["--public-url", "https://mcp.example/not-mcp"],
  "path must match"
);
await expectStartupFailure([], "must be a 256-bit base64url token", {
  SKYLIGHT_MCP_HTTP_TOKEN: "short",
});
await expectStartupFailure(["--port", "0"], "requires a fixed port", {
  SKYLIGHT_MCP_HTTP_TOKEN: "",
});
await expectStartupFailure(
  ["--public-url", "https://mcp.example/mcp"],
  "requires both SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS and SKYLIGHT_MCP_OAUTH_JWKS_URL",
  { SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS: "https://auth.example" }
);

const defaultOAuthPort = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (address === null || typeof address === "string") return reject(new Error("Could not reserve default OAuth port"));
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const defaultOAuthChild = spawn(process.execPath, ["dist/http-mcp.js", "--port", String(defaultOAuthPort)], {
  env: {
    ...process.env,
    SKYLIGHT_MCP_HTTP_TOKEN: "",
    SKYLIGHT_MCP_OAUTH_LOGIN: "",
    SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS: "",
    SKYLIGHT_MCP_OAUTH_JWKS_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
defaultOAuthChild.stdout.setEncoding("utf8");
defaultOAuthChild.stderr.setEncoding("utf8");
let defaultOAuthStderr = "";
defaultOAuthChild.stderr.on("data", (chunk) => { defaultOAuthStderr += chunk; });
const defaultOAuthUrlText = await new Promise((resolve, reject) => {
  let output = "";
  const timeout = setTimeout(() => reject(new Error(`Default OAuth startup timed out: ${defaultOAuthStderr}`)), 10_000);
  defaultOAuthChild.stdout.on("data", (chunk) => {
    output += chunk;
    const newline = output.indexOf("\n");
    if (newline >= 0) {
      clearTimeout(timeout);
      resolve(output.slice(0, newline).trim());
    }
  });
  defaultOAuthChild.on("error", reject);
  defaultOAuthChild.on("exit", (code) => reject(new Error(`Default OAuth HTTP MCP exited ${code}: ${defaultOAuthStderr}`)));
});
try {
  const defaultOAuthUrl = new URL(defaultOAuthUrlText);
  const metadataResponse = await fetch(new URL("/.well-known/oauth-protected-resource/mcp", defaultOAuthUrl));
  const metadata = await metadataResponse.json();
  const expectedIssuer = `http://127.0.0.1:${defaultOAuthPort}`;
  if (
    metadata.resource !== defaultOAuthUrl.href ||
    metadata.authorization_servers?.[0] !== expectedIssuer
  ) {
    throw new Error(`Zero-config OAuth metadata was invalid: ${JSON.stringify(metadata)}`);
  }
  const authorizationMetadata = await fetch(`${expectedIssuer}/.well-known/oauth-authorization-server`);
  if (!authorizationMetadata.ok) throw new Error("Zero-config OAuth authorization metadata was unavailable");
  const challengeResponse = await fetch(defaultOAuthUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  if (challengeResponse.status !== 401 || !challengeResponse.headers.get("www-authenticate")?.includes("resource_metadata=")) {
    throw new Error("Zero-config HTTP MCP did not require OAuth");
  }
} finally {
  defaultOAuthChild.kill("SIGTERM");
  await new Promise((resolve) => defaultOAuthChild.once("exit", resolve));
}

const child = spawn(process.execPath, ["dist/http-mcp.js", "--port", "0"], {
  env: {
    ...process.env,
    SKYLIGHT_MCP_HTTP_TOKEN: token,
    SKYLIGHT_MCP_HTTP_ALLOWED_ORIGINS: "https://client.example",
    SKYLIGHT_MCP_HTTP_MAX_REQUEST_BYTES: "1024",
    SKYLIGHT_MCP_HTTP_MAX_BATCH_SIZE: "2",
    SKYLIGHT_MCP_HTTP_SESSION_TTL_MS: "60000",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
const urlText = await new Promise((resolve, reject) => {
  let output = "";
  const timeout = setTimeout(() => reject(new Error(`HTTP MCP startup timed out: ${stderr}`)), 10_000);
  child.stdout.on("data", (chunk) => {
    output += chunk;
    const newline = output.indexOf("\n");
    if (newline >= 0) {
      clearTimeout(timeout);
      resolve(output.slice(0, newline).trim());
    }
  });
  child.on("error", reject);
  child.on("exit", (code) => reject(new Error(`HTTP MCP exited ${code}: ${stderr}`)));
});
const url = new URL(urlText);
const rawRequest = (headers, body = "{}") => new Promise((resolve, reject) => {
  const request = http.request(url, { method: "POST", headers }, (response) => {
    response.resume();
    response.on("end", () => resolve(response.statusCode));
  });
  request.on("error", reject);
  request.end(body);
});

try {
  const health = await fetch(new URL("/healthz", url));
  if (!health.ok || !(await health.json()).ok) throw new Error("Health endpoint failed");

  const unauthorized = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  if (unauthorized.status !== 401 || unauthorized.headers.get("www-authenticate") !== 'Bearer realm="skylight-mcp"') {
    throw new Error("Missing bearer challenge");
  }

  const badHost = await rawRequest({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      host: "attacker.example",
  });
  if (badHost !== 421) throw new Error(`DNS rebinding defense returned ${badHost}`);

  const badOrigin = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      origin: "https://attacker.example",
    },
    body: "{}",
  });
  if (badOrigin.status !== 403) throw new Error(`Origin defense returned ${badOrigin.status}`);

  const malformedBearer = await fetch(url, {
    method: "POST",
    headers: { authorization: `Basic ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (malformedBearer.status !== 401) throw new Error(`Malformed bearer returned ${malformedBearer.status}`);

  const allowedOrigin = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-session-id": "unknown",
      origin: "https://client.example",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const allowedOriginBody = await allowedOrigin.json();
  if (
    allowedOrigin.status !== 200 ||
    allowedOriginBody.error?.code !== -32600 ||
    allowedOrigin.headers.get("access-control-allow-origin") !== "https://client.example" ||
    !allowedOrigin.headers.get("access-control-expose-headers")?.toLowerCase().includes("mcp-session-id")
  ) {
    throw new Error("Allowed CORS origin was not reflected safely");
  }

  const batch = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]),
  });
  const batchBody = await batch.json();
  if (batch.status !== 200 || !Array.isArray(batchBody) || batchBody.length !== 2) {
    throw new Error(`JSON-RPC batch returned ${batch.status}`);
  }

  const oversizedBatch = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
      { jsonrpc: "2.0", id: 3, method: "ping" },
    ]),
  });
  if (oversizedBatch.status !== 400) {
    throw new Error(`Oversized JSON-RPC batch returned ${oversizedBatch.status}`);
  }

  const oversized = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(2_000) }),
  });
  if (oversized.status !== 413) throw new Error(`Oversized request returned ${oversized.status}`);

  const invalidSession = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "mcp-session-id": "unknown",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const invalidSessionBody = await invalidSession.json();
  if (invalidSession.status !== 200 || invalidSessionBody.error?.code !== -32600) {
    throw new Error(`Invalid session returned ${invalidSession.status}`);
  }

  const client = new Client({ name: "skylight-http-smoke", version: "1" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  const tools = await client.listTools();
  if (!tools.tools.some((tool) => tool.name === "skylight__profiles__frame")) {
    throw new Error("HTTP MCP omitted expected tools");
  }
  const frame = await client.callTool({ name: "skylight__profiles__frame", arguments: {} });
  const serialized = JSON.stringify(frame);
  if (!serialized.includes("5149695") || !serialized.includes("cintiaandkamil_calendar") || !serialized.includes("calendar")) {
    throw new Error(`HTTP MCP resolved the wrong resource: ${serialized.slice(0, 2_000)}`);
  }
  await transport.terminateSession();
  await client.close();
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (address === null || typeof address === "string") return reject(new Error("Could not reserve OAuth test port"));
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const oauthChild = spawn(process.execPath, [
  "dist/http-mcp.js",
  "--port", String(port),
  "--public-url", "https://mcp.example/mcp",
], {
  env: {
    ...process.env,
    SKYLIGHT_MCP_HTTP_TOKEN: "",
    SKYLIGHT_MCP_OAUTH_AUTHORIZATION_SERVERS: "https://auth.example",
    SKYLIGHT_MCP_OAUTH_JWKS_URL: "https://auth.example/.well-known/jwks.json",
    SKYLIGHT_MCP_OAUTH_SCOPES: "mcp.read,mcp.write",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
oauthChild.stdout.setEncoding("utf8");
oauthChild.stderr.setEncoding("utf8");
let oauthStderr = "";
oauthChild.stderr.on("data", (chunk) => { oauthStderr += chunk; });
await new Promise((resolve, reject) => {
  let output = "";
  const timeout = setTimeout(() => reject(new Error(`OAuth HTTP MCP startup timed out: ${oauthStderr}`)), 10_000);
  oauthChild.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("\n")) {
      clearTimeout(timeout);
      resolve();
    }
  });
  oauthChild.on("error", reject);
  oauthChild.on("exit", (code) => reject(new Error(`OAuth HTTP MCP exited ${code}: ${oauthStderr}`)));
});
try {
  const actualUrl = new URL(`http://127.0.0.1:${port}/mcp`);
  const metadataResponse = await fetch(new URL("/.well-known/oauth-protected-resource/mcp", actualUrl));
  const metadata = await metadataResponse.json();
  if (
    !metadataResponse.ok ||
    metadata.resource !== "https://mcp.example/mcp" ||
    metadata.authorization_servers?.[0] !== "https://auth.example/" ||
    metadata.scopes_supported?.join(",") !== "mcp.read,mcp.write"
  ) {
    throw new Error(`OAuth protected-resource metadata was invalid: ${JSON.stringify(metadata)}`);
  }
  const challengeResponse = await fetch(actualUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  const challenge = challengeResponse.headers.get("www-authenticate") ?? "";
  if (challengeResponse.status !== 401 || !challenge.includes("resource_metadata=")) {
    throw new Error(`OAuth bearer challenge was invalid: ${challengeResponse.status} ${challenge}`);
  }
} finally {
  oauthChild.kill("SIGTERM");
  await new Promise((resolve) => oauthChild.once("exit", resolve));
}

console.log("http-mcp-security-oauth-and-calendar-ok");
