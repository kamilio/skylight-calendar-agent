import { spawn } from "node:child_process";
import http from "node:http";

let requestBody;
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    requestBody = JSON.parse(body);
    response.setHeader("content-type", "application/json");
    response.end('{"ok":true}');
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const child = spawn(process.execPath, ["dist/mcp.js"], {
  env: {
    ...process.env,
    SKYLIGHT_API_BASE: `http://127.0.0.1:${address.port}`,
    SKYLIGHT_AUTH_HEADER: "Bearer test",
    SKYLIGHT_FRAME_ID: "42",
  },
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const responseMessages = new Map();
const responseWaiters = new Map();
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const newlineIndex = buffer.indexOf("\n");
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id !== undefined) {
      responseMessages.set(message.id, message);
      responseWaiters.get(message.id)?.(message);
      responseWaiters.delete(message.id);
    }
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function waitForResponse(id) {
  const existing = responseMessages.get(id);
  if (existing !== undefined) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      responseWaiters.delete(id);
      reject(new Error(`MCP response ${id} timed out`));
    }, 5_000);
    responseWaiters.set(id, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
}

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0.0" },
    },
  });
  await waitForResponse(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "skylight__lists__create_raw",
      arguments: { list_json: { label: "Native MCP JSON" } },
    },
  });
  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "skylight__profiles__user_update",
      arguments: { updates_json: "super-secret" },
    },
  });

  const [responseMessage, invalidJsonResponse] = await Promise.all([
    waitForResponse(2),
    waitForResponse(3),
  ]);
  if (responseMessage?.error) {
    throw new Error(`Native MCP JSON call failed: ${JSON.stringify(responseMessage.error)}`);
  }
  if (responseMessage?.result === undefined) throw new Error("Native MCP JSON call timed out");
  if (requestBody?.label !== "Native MCP JSON") {
    throw new Error(`Native MCP JSON body was not preserved: ${JSON.stringify(requestBody)}`);
  }
  const invalidJsonMessage = invalidJsonResponse?.error?.message;
  if (
    typeof invalidJsonMessage !== "string" ||
    !invalidJsonMessage.includes("The value was not displayed.")
  ) {
    throw new Error(`MCP invalid JSON error was not safely reported: ${invalidJsonMessage}`);
  }
  if (invalidJsonMessage.includes("super-secret")) {
    throw new Error(`MCP invalid JSON error exposed a protected value: ${invalidJsonMessage}`);
  }
} finally {
  child.kill();
  server.close();
}
