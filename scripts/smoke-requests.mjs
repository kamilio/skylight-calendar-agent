import { spawn } from "node:child_process";
import http from "node:http";

const requests = [];
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => {
    requests.push({
      method: request.method,
      url: request.url,
      body: body ? JSON.parse(body) : null,
    });
    if (request.method === "DELETE") {
      response.statusCode = 204;
      response.end();
    } else {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    }
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const env = {
  ...process.env,
  SKYLIGHT_API_BASE: `http://127.0.0.1:${address.port}`,
  SKYLIGHT_AUTH_HEADER: "Bearer test",
  SKYLIGHT_FRAME_ID: "42",
};

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/cli.js", ...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(" ")} failed (${code}): ${stderr}`));
    });
    child.on("error", reject);
  });
}

async function runExpectingFailure(args) {
  const requestCount = requests.length;
  try {
    await run(args);
  } catch {
    if (requests.length !== requestCount) {
      throw new Error(`${args.join(" ")} reached the API despite invalid input`);
    }
    return;
  }
  throw new Error(`${args.join(" ")} unexpectedly succeeded`);
}

try {
  await run(["lists", "create", "--label", "Weekend", "--kind", "to_do"]);
  await run([
    "lists",
    "item-create",
    "--list-id",
    "7",
    "--label",
    "Buy filters",
    "--section",
    "House",
  ]);
  await run([
    "lists",
    "items-create",
    "--list-id",
    "7",
    "--labels",
    "Install filter",
    "Recycle old filter",
  ]);
  await run([
    "tasks",
    "chore-create-simple",
    "--summary",
    "Replace filter",
    "--start",
    "2026-07-12",
  ]);
  await run(["lists", "delete", "--list-id", "7"]);
  await run(["lists", "get", "--list-id", "../../user"]);
  await runExpectingFailure(["lists", "create", "--label", ""]);
  await runExpectingFailure(["lists", "create", "--label", "   "]);
  await runExpectingFailure([
    "tasks",
    "chore-create-simple",
    "--summary",
    "Replace filter",
    "--start",
    "2026-02-30",
  ]);
  await runExpectingFailure([
    "calendar",
    "events",
    "--date-min",
    "2026-07-20",
    "--date-max",
    "2026-07-10",
  ]);
  await runExpectingFailure(["meals", "list", "--date-min", "2026-13-01"]);
  await runExpectingFailure(["photos", "list", "--page", "0"]);
  await runExpectingFailure(["photos", "list", "--page", "1.5"]);
  await runExpectingFailure(["photos", "album-create", "--title", "   "]);
  await runExpectingFailure(["lists", "create-raw", "--list-json", "null"]);
  await runExpectingFailure(["lists", "create-raw", "--list-json", "[]"]);
} finally {
  server.close();
}

const expected = [
  {
    method: "POST",
    url: "/api/frames/42/lists",
    body: {
      label: "Weekend",
      kind: "to_do",
      color: "#A8D4D3",
      hide_on_device: false,
      default_grocery_list: false,
    },
  },
  {
    method: "POST",
    url: "/api/frames/42/lists/7/list_items",
    body: { label: "Buy filters", section: "House" },
  },
  {
    method: "POST",
    url: "/api/frames/42/lists/7/list_items",
    body: { label: "Install filter", section: null },
  },
  {
    method: "POST",
    url: "/api/frames/42/lists/7/list_items",
    body: { label: "Recycle old filter", section: null },
  },
];

for (const [index, expectedRequest] of expected.entries()) {
  if (JSON.stringify(requests[index]) !== JSON.stringify(expectedRequest)) {
    throw new Error(`Request ${index + 1} did not match the expected payload`);
  }
}

if (
  requests[4]?.url !== "/api/frames/42/chores/create_multiple" ||
  requests[4]?.body?.start !== "2026-07-12"
) {
  throw new Error("Dated chore request did not match the expected payload");
}

if (requests[5]?.method !== "DELETE" || requests[5]?.url !== "/api/frames/42/lists/7") {
  throw new Error("Delete request did not complete successfully with a 204 response");
}

if (requests[6]?.url !== "/api/frames/42/lists/..%2F..%2Fuser") {
  throw new Error(`Path parameter was not safely encoded: ${requests[6]?.url}`);
}
