import { spawn } from "node:child_process";
import http from "node:http";
import { listCalendarFrames, resolveFrameId } from "../dist/skylight/frame.js";

const originalAuthHeader = process.env.SKYLIGHT_AUTH_HEADER;
process.env.SKYLIGHT_AUTH_HEADER = "Bearer test";
try {
  try {
    await listCalendarFrames({
      fetch: async () => Response.json({ data: {} }),
    });
    throw new Error("Malformed frame list unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Frame list response is missing a data array")) throw error;
  }
  try {
    await listCalendarFrames({
      fetch: async () => Response.json({ data: [null] }),
    });
    throw new Error("Malformed frame record unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Frame list response contains an invalid frame id")) throw error;
  }
} finally {
  if (originalAuthHeader === undefined) delete process.env.SKYLIGHT_AUTH_HEADER;
  else process.env.SKYLIGHT_AUTH_HEADER = originalAuthHeader;
}

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
  missing.paths.join(",") !==
    "/api/frames/123,/api/frames/calendar,/api/frames/456/lists"
) {
  throw new Error(`Missing candidate did not fall back correctly: ${JSON.stringify(missing)}`);
}

const savedEnv = { ...process.env };
try {
  delete process.env.SKYLIGHT_FRAME_ID;
  delete process.env.SKYLIGHT_CALENDAR_URL;
  process.env.SKYLIGHT_API_BASE = "https://example.invalid";
  process.env.SKYLIGHT_AUTH_HEADER = "Bearer test";
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetch = async () => {
    calls += 1;
    await gate;
    return Response.json({ data: [{ id: "789" }] });
  };
  const first = resolveFrameId({ fetch });
  const second = resolveFrameId({ fetch });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (calls !== 1) throw new Error(`Concurrent frame discovery made ${calls} requests`);
  release();
  const ids = await Promise.all([first, second]);
  if (ids[0] !== "789" || ids[1] !== "789") {
    throw new Error(`Concurrent frame discovery returned wrong ids: ${ids.join(",")}`);
  }
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}
