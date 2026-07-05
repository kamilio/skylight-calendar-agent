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
  await run([
    "lists",
    "create",
    "--label",
    "Weekend",
    "--kind",
    "to_do",
    "--color",
    "A8D4D3",
  ]);
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
    "--recurrence-rrule",
    "RRULE:FREQ=DAILY",
  ]);
  await run(["lists", "delete", "--list-id", "7"]);
  await run(["lists", "get", "--list-id", "../../user"]);
  await run([
    "meals",
    "create",
    "--recipe-id",
    "recipe-1",
    "--category-id",
    "category-1",
    "--extras-json",
    '{"meal_recipe_id":"wrong","meal_category_id":"wrong"}',
  ]);
  await run([
    "calendar",
    "event-edit",
    "--event-id",
    "event-1",
    "--summary",
    "Updated title",
  ]);
  await run(["tasks", "taskbox-create", "--summary", "Pack lunch"]);
  await run([
    "tasks",
    "chores",
    "--after",
    "2026-07-01",
    "--before",
    "2026-07-31",
  ]);
  await run([
    "calendar",
    "notification-settings-update",
    "--on-time",
    "--early=false",
  ]);
  await runExpectingFailure(["lists", "create", "--label", ""]);
  await runExpectingFailure(["lists", "create", "--label", "   "]);
  await runExpectingFailure([
    "calendar",
    "source-calendar-save",
    "--calendar-id",
    " ",
    "--attributes-json",
    '{"name":"Family"}',
  ]);
  await runExpectingFailure([
    "tasks",
    "taskbox-save",
    "--task-box-item-json",
    '{"id":"","summary":"Pack lunch"}',
  ]);
  await runExpectingFailure([
    "tasks",
    "taskbox-save",
    "--task-box-item-json",
    '{"id":null,"summary":"Pack lunch"}',
  ]);
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
  await runExpectingFailure([
    "calendar",
    "events",
    "--date-min",
    "2026-07-10",
    "--date-max",
    "2026-07-20",
    "--timezone",
    "Definitely/Invalid",
  ]);
  await runExpectingFailure(["meals", "list", "--date-min", "2026-13-01"]);
  await runExpectingFailure(["photos", "list", "--page", "0"]);
  await runExpectingFailure(["photos", "list", "--page", "1.5"]);
  await runExpectingFailure(["photos", "list-paged", "--page-token", "   "]);
  await runExpectingFailure(["photos", "album-create", "--title", "   "]);
  await runExpectingFailure(["rewards", "list", "--redeemed-at-min", "not-a-date"]);
  await runExpectingFailure(["rewards", "list", "--redeemed-at-min", "2026-07-10"]);
  await runExpectingFailure(["calendar", "webcal-sync", "--calendar-url", "not-a-url"]);
  await runExpectingFailure([
    "calendar",
    "sync-oauth-url",
    "--provider",
    "google",
    "--redirect-url",
    "not-a-url",
    "--failure-redirect-url",
    "https://example.com/failure",
  ]);
  await runExpectingFailure([
    "calendar",
    "sync-oauth-url",
    "--provider",
    "google",
    "--redirect-url",
    "https://example.com/success",
    "--failure-redirect-url",
    "https://example.com/failure",
    "--email",
    "not-an-email",
  ]);
  await runExpectingFailure([
    "calendar",
    "sync-oauth-url",
    "--provider",
    "google",
    "--redirect-url",
    "javascript:alert(1)",
    "--failure-redirect-url",
    "https://example.com/failure",
  ]);
  await runExpectingFailure([
    "rewards",
    "list",
    "--redeemed-at-min",
    "2026-07-20T12:00:00Z",
    "--redeemed-at-max",
    "2026-07-10T12:00:00Z",
  ]);
  await runExpectingFailure(["lists", "create-raw", "--list-json", "null"]);
  await runExpectingFailure(["lists", "create-raw", "--list-json", "[]"]);
  await runExpectingFailure(["lists", "create-raw", "--list-json", "{}"]);
  await runExpectingFailure([
    "calendar",
    "source-calendar-link-profiles",
    "--calendar-id",
    "7",
    "--categorizations-json",
    "null",
  ]);
  await runExpectingFailure([
    "lists",
    "update",
    "--list-id",
    "7",
    "--updates-json",
    "{}",
  ]);
  await runExpectingFailure(["profiles", "forgot-password", "--email", "not-an-email"]);
  await runExpectingFailure([
    "tasks",
    "chore-status",
    "--series-id",
    "7",
    "--status",
    "completed",
    "--instance-date",
    "2026-07-05",
    "--instance-time",
    "29:90",
  ]);
  await runExpectingFailure([
    "calendar",
    "event-create",
    "--summary",
    "Bad date",
    "--starts-at",
    "whenever",
  ]);
  await runExpectingFailure([
    "calendar",
    "event-create",
    "--summary",
    "Impossible date",
    "--starts-at",
    "2026-02-30T10:00:00Z",
  ]);
  await runExpectingFailure([
    "calendar",
    "event-create",
    "--summary",
    "Reversed",
    "--starts-at",
    "2026-07-20",
    "--ends-at",
    "2026-07-10",
  ]);
  await runExpectingFailure([
    "calendar",
    "event-create",
    "--summary",
    "Missing rule",
    "--starts-at",
    "2026-07-10",
    "--recurring",
  ]);
  await runExpectingFailure([
    "calendar",
    "event-create",
    "--summary",
    "Contradictory rule",
    "--starts-at",
    "2026-07-10",
    "--recurring=false",
    "--rrule",
    "FREQ=DAILY",
  ]);
  await runExpectingFailure(["calendar", "event-edit", "--event-id", "event-1"]);
  await runExpectingFailure([
    "meals",
    "update",
    "--meal-id",
    "meal-1",
    "--instance-iso",
    "2026-07-05T12:00:00Z",
  ]);
  await runExpectingFailure([
    "meals",
    "delete",
    "--meal-id",
    "meal-1",
    "--instance-iso",
    "not-a-date",
  ]);
  await runExpectingFailure([
    "meals",
    "update",
    "--meal-id",
    "meal-1",
    "--instance-iso",
    "2026-07-05T12:00:00Z",
    "--updates-json",
    "{}",
  ]);
  await runExpectingFailure(["recipes", "update", "--recipe-id", "recipe-1"]);
  await runExpectingFailure([
    "recipes",
    "create",
    "--category-id",
    "   ",
    "--summary",
    "Dinner",
  ]);
  await runExpectingFailure([
    "tasks",
    "chore-create-simple",
    "--summary",
    "Fractional points",
    "--start",
    "2026-07-10",
    "--reward-points",
    "1.5",
  ]);
  await runExpectingFailure([
    "tasks",
    "chore-create-simple",
    "--summary",
    "Empty rule",
    "--start",
    "2026-07-10",
    "--recurrence-rrule",
    "RRULE:",
  ]);
  await runExpectingFailure([
    "rewards",
    "points-add",
    "--category-ids",
    "1",
    "--points",
    "1.5",
  ]);
  await runExpectingFailure(["profiles", "owner-profile-update"]);
  await runExpectingFailure(["profiles", "frames", "--type", "calender"]);
  await runExpectingFailure(["calendar", "notification-settings-update"]);
  await runExpectingFailure([
    "calendar",
    "notification-settings-update",
    "--on-time=false",
    "--early",
  ]);
  await runExpectingFailure([
    "calendar",
    "notification-settings-update",
    "--on-time=false",
    "--early=false",
    "--early-minutes-before",
    "10",
  ]);
  await runExpectingFailure([
    "calendar",
    "event-create",
    "--summary",
    "Missing longitude",
    "--starts-at",
    "2026-07-10",
    "--lat",
    "40",
  ]);
  await runExpectingFailure(["lists", "create", "--label", "Bad color", "--color", "blue"]);
  await runExpectingFailure([
    "lists",
    "item-move",
    "--list-id",
    "7",
    "--item-id",
    "8",
    "--after-item-id",
    "not-a-number",
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
  requests[4]?.body?.start !== "2026-07-12" ||
  requests[4]?.body?.recurrence_set?.[0] !== "RRULE:FREQ=DAILY"
) {
  throw new Error("Dated chore request did not match the expected payload");
}

if (requests[5]?.method !== "DELETE" || requests[5]?.url !== "/api/frames/42/lists/7") {
  throw new Error("Delete request did not complete successfully with a 204 response");
}

if (requests[6]?.url !== "/api/frames/42/lists/..%2F..%2Fuser") {
  throw new Error(`Path parameter was not safely encoded: ${requests[6]?.url}`);
}

if (
  requests[7]?.body?.meal_recipe_id !== "recipe-1" ||
  requests[7]?.body?.meal_category_id !== "category-1"
) {
  throw new Error("Explicit meal fields were overwritten by extrasJson");
}

if (
  requests[8]?.url !== "/api/frames/42/calendar_events/event-1" ||
  requests[8]?.body?.summary !== "Updated title" ||
  Object.hasOwn(requests[8]?.body ?? {}, "timezone")
) {
  throw new Error("Event edit changed unspecified fields");
}

const taskBoxCreate = requests.find(
  (request) => request.url === "/api/frames/42/task_box/items"
);
if (
  taskBoxCreate?.body?.data?.type !== "task_box_item" ||
  taskBoxCreate?.body?.data?.attributes?.summary !== "Pack lunch"
) {
  throw new Error("Task Box convenience command did not send the documented JSON:API shape");
}

const notificationUpdate = requests.find(
  (request) => request.url === "/api/frames/42/event_notification_settings"
);
if (
  notificationUpdate?.body?.on_time !== true ||
  notificationUpdate?.body?.early !== false ||
  notificationUpdate?.body?.early_minutes_before !== null
) {
  throw new Error("Notification settings update did not preserve explicit boolean values");
}

const choresList = requests.find((request) => request.url?.includes("/chores?"));
if (
  !choresList?.url?.includes("include_late=true") ||
  !choresList?.url?.includes("include_up_for_grabs=false")
) {
  throw new Error(`Chore list did not send captured defaults: ${choresList?.url}`);
}
