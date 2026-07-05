import { spawn } from "node:child_process";
import {
  assertValidAbsoluteUrl,
  assertValidDate,
  assertValidDateOrDateTimeRange,
  pathSegment,
} from "../dist/skylight/validation.js";

try {
  assertValidAbsoluteUrl("https://example.com/\uD800", "calendarUrl", ["https:"]);
  throw new Error("Malformed Unicode URL unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("calendarUrl contains invalid Unicode")) throw error;
}

assertValidDate("0099-01-01", "date");
assertValidDate("0000-02-29", "date");

const originalTimezone = process.env.TZ;
try {
  process.env.TZ = "Asia/Tokyo";
  assertValidDateOrDateTimeRange(
    "2026-01-01",
    "2026-01-01T00:00",
    "startsAt",
    "endsAt"
  );
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}

try {
  pathSegment("\uD800", "id");
  throw new Error("Malformed Unicode path id unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("id contains invalid Unicode")) throw error;
}

const env = { ...process.env, SKYLIGHT_FRAME_ID: "42" };
for (const name of [
  "SKYLIGHT_AUTH_HEADER",
  "SKYLIGHT_BASIC_TOKEN",
  "SKYLIGHT_BEARER_TOKEN",
  "SKYLIGHT_EMAIL",
  "SKYLIGHT_PASSWORD",
]) {
  delete env[name];
}

async function expectLocalError(args, expected) {
  const child = spawn(process.execPath, ["dist/cli.js", ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });

  if (code === 0) throw new Error(`Invalid local input unexpectedly succeeded: ${args.join(" ")}`);
  if (!output.includes(expected)) {
    throw new Error(`Local validation error was not reported: ${output}`);
  }
  if (output.includes("Missing credentials")) {
    throw new Error(`Credential validation ran before local validation: ${output}`);
  }
}

await expectLocalError(
  ["lists", "create-raw", "--list-json", "not-json"],
  'Invalid value for "listJson". Expected valid JSON'
);
await expectLocalError(
  ["lists", "get", "--list-id", " "],
  'Invalid value for "listId": " " does not match pattern "\\S"'
);
