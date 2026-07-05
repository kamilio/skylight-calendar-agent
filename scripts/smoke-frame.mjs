import { spawn } from "node:child_process";
import http from "node:http";

async function runScenario(candidateStatus) {
  const paths = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/frames/123") {
      response.statusCode = candidateStatus;
      response.end(JSON.stringify({ error: "candidate response" }));
      return;
    }
    response.end(JSON.stringify({ data: [{ id: "456", attributes: { name: "Home" } }] }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock server did not start");

  const child = spawn(process.execPath, ["dist/cli.js", "lists", "list"], {
    env: {
      ...process.env,
      SKYLIGHT_API_BASE: `http://127.0.0.1:${address.port}`,
      SKYLIGHT_AUTH_HEADER: "Bearer test",
      SKYLIGHT_CALENDAR_URL: "https://ourskylight.com/calendar/123",
      SKYLIGHT_FRAME_ID: "",
    },
    stdio: "ignore",
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  server.close();
  return { code, paths };
}

const unauthorized = await runScenario(401);
if (unauthorized.code === 0 || unauthorized.paths.join(",") !== "/api/frames/123") {
  throw new Error(`Authentication failure was incorrectly masked: ${JSON.stringify(unauthorized)}`);
}

const missing = await runScenario(404);
if (
  missing.code !== 0 ||
  missing.paths.join(",") !== "/api/frames/123,/api/frames,/api/frames/456/lists"
) {
  throw new Error(`Missing candidate did not fall back correctly: ${JSON.stringify(missing)}`);
}
