import { spawn } from "node:child_process";
import http from "node:http";

let requestBody;
const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/api/frames/calendar") {
    response.setHeader("content-type", "application/json");
    response.end('{"data":[{"id":"42","attributes":{"apps":["calendar"]}}]}');
    return;
  }
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    if (request.method === "GET" && request.url === "/api/frames/42/reward_points") {
      response.setHeader("content-type", "application/json");
      response.end('[{"category_id":"category-1","points":12}]');
      return;
    }
    if (request.method === "DELETE" && request.url === "/api/frames/42/lists/7") {
      response.statusCode = 204;
      response.end();
      return;
    }
    requestBody = body.length === 0 ? undefined : JSON.parse(body);
    response.setHeader("content-type", "application/json");
    response.end('{"ok":true,"layout":"safe\\nkeep"}');
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
  send({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "skylight__calendar__events",
      arguments: { date_min: "\u001b[31m\r\n\u202e", date_max: "2026-07-31" },
    },
  });
  send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "skylight__rewards__points",
      arguments: {},
    },
  });
  send({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "skylight__lists__delete",
      arguments: { list_id: "7" },
    },
  });
  child.stdin.write("{invalid json\n");

  const [
    responseMessage,
    invalidJsonResponse,
    unsafeValidationResponse,
    pointsResponse,
    deleteResponse,
    parseErrorResponse,
  ] = await Promise.all([
    waitForResponse(2),
    waitForResponse(3),
    waitForResponse(4),
    waitForResponse(5),
    waitForResponse(6),
    waitForResponse(null),
  ]);
  if (responseMessage?.error) {
    throw new Error(`Native MCP JSON call failed: ${JSON.stringify(responseMessage.error)}`);
  }
  if (responseMessage?.result === undefined) throw new Error("Native MCP JSON call timed out");
  const responsePayload = JSON.parse(responseMessage.result?.content?.[0]?.text ?? "null");
  if (responsePayload?.layout !== "safe\nkeep") {
    throw new Error(`Successful MCP response layout was altered: ${JSON.stringify(responseMessage.result)}`);
  }
  if (
    JSON.stringify(responseMessage.result.structuredContent) !==
    JSON.stringify(responsePayload)
  ) {
    throw new Error("MCP structured content must match its JSON text fallback");
  }
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
  const unsafeValidationMessage = unsafeValidationResponse?.error?.message;
  if (
    typeof unsafeValidationMessage !== "string" ||
    /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/.test(unsafeValidationMessage)
  ) {
    throw new Error(`MCP validation error retained terminal controls: ${JSON.stringify(unsafeValidationMessage)}`);
  }
  if (parseErrorResponse?.error?.code !== -32700) {
    throw new Error(`Malformed MCP JSON did not receive a parse error: ${JSON.stringify(parseErrorResponse)}`);
  }
  const pointsPayload = JSON.parse(pointsResponse?.result?.content?.[0]?.text ?? "null");
  if (
    pointsPayload?.data?.[0]?.category_id !== "category-1" ||
    JSON.stringify(pointsResponse?.result?.structuredContent) !== JSON.stringify(pointsPayload)
  ) {
    throw new Error(`Root array was not normalized for MCP: ${JSON.stringify(pointsResponse)}`);
  }
  const deletePayload = JSON.parse(deleteResponse?.result?.content?.[0]?.text ?? "null");
  if (
    deletePayload?.ok !== true ||
    JSON.stringify(deleteResponse?.result?.structuredContent) !== JSON.stringify(deletePayload)
  ) {
    throw new Error(`Empty response was not normalized for MCP: ${JSON.stringify(deleteResponse)}`);
  }
} finally {
  child.kill();
  server.close();
}
