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
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
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
