import { spawn } from "node:child_process";
import http from "node:http";

let requestCount = 0;
const server = http.createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/frames/calendar") {
      response.end('{"data":[{"id":"42","attributes":{"apps":["calendar"]}}]}');
      return;
    }
    requestCount += 1;
    if (requestCount === 2) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "simulated failure" }));
    } else {
      response.end(JSON.stringify({ data: { id: String(requestCount) } }));
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const child = spawn(
  process.execPath,
  [
    "dist/cli.js",
    "lists",
    "items-create",
    "--list-id",
    "7",
    "--labels",
    "First item",
    "Second item",
  ],
  {
    env: {
      ...process.env,
      SKYLIGHT_API_BASE: `http://127.0.0.1:${address.port}`,
      SKYLIGHT_AUTH_HEADER: "Bearer test",
      SKYLIGHT_FRAME_ID: "42",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});
const code = await new Promise((resolve) => child.on("exit", resolve));
server.close();

if (code === 0) throw new Error("Partial failure unexpectedly succeeded");
if (requestCount !== 2) throw new Error(`Expected two requests, received ${requestCount}`);
if (!output.includes("Created 1 of 2 items") || !output.includes("Second item")) {
  throw new Error(`Partial failure did not explain completed work: ${output}`);
}
