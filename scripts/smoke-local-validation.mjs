import { spawn } from "node:child_process";
import {
  assertValidAbsoluteUrl,
  assertValidDate,
  assertValidDateOrDateTimeRange,
  assertValidDateTime,
  assertValidDateTimeRange,
  pathSegment,
} from "../dist/skylight/validation.js";
import { root } from "../dist/root.js";

function kebabCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function unwrap(schema) {
  let current = schema;
  while (current.kind === "optional") current = current.inner;
  return current;
}

try {
  assertValidAbsoluteUrl("https://example.com/\uD800", "calendarUrl", ["https:"]);
  throw new Error("Malformed Unicode URL unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("calendarUrl contains invalid Unicode")) throw error;
}

try {
  assertValidAbsoluteUrl("https://example.com/\npath", "calendarUrl", ["https:"]);
  throw new Error("Control-character URL unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("calendarUrl must not contain control characters")) throw error;
}

try {
  assertValidAbsoluteUrl("https://user:secret@example.com/calendar.ics", "calendarUrl", [
    "https:",
  ]);
  throw new Error("Credential-bearing URL unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("calendarUrl must not include embedded username or password")) {
    throw error;
  }
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

try {
  pathSegment("\u001b", "id");
  throw new Error("Control-character path id unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("id must not contain control characters")) throw error;
}

for (const value of ["2026-01-01T00:00+14:01", "2026-01-01T00:00-23:59"]) {
  try {
    assertValidDateOrDateTimeRange(value, undefined, "startsAt", "endsAt");
    throw new Error(`Impossible UTC offset unexpectedly succeeded: ${value}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("startsAt must be a valid ISO datetime")) throw error;
  }
}

assertValidDateTime("2026-12-31T23:59:60Z", "redeemedAtMax");
try {
  assertValidDateTime("2026-12-31T23:59Z", "redeemedAtMax");
  throw new Error("RFC3339 datetime without seconds unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("must be a valid RFC3339 datetime with seconds")) throw error;
}
assertValidDateOrDateTimeRange(
  "2026-12-31T23:59:60Z",
  "2027-01-01T00:00:00Z",
  "redeemedAtMin",
  "redeemedAtMax"
);

for (const validateRange of [assertValidDateTimeRange, assertValidDateOrDateTimeRange]) {
  try {
    validateRange(
      "2026-01-01T00:00:00.0009Z",
      "2026-01-01T00:00:00.0001Z",
      "minimum",
      "maximum"
    );
    throw new Error("Reversed sub-millisecond datetime range unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("minimum must not be after maximum")) throw error;
  }
  validateRange(
    "2026-01-01T00:00:00.00010Z",
    "2026-01-01T00:00:00.000100Z",
    "minimum",
    "maximum"
  );
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

async function expectLocalError(args, expected, forbidden) {
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
  if (forbidden !== undefined && output.includes(forbidden)) {
    throw new Error(`Local validation error exposed a protected value: ${output}`);
  }
  if (output.includes("\u001b")) {
    throw new Error(`Local validation error retained terminal escapes: ${JSON.stringify(output)}`);
  }
  if (output.includes("Missing credentials")) {
    throw new Error(`Credential validation ran before local validation: ${output}`);
  }
}

await expectLocalError(
  ["lists", "create-raw", "--list-json", "not-json"],
  "Invalid JSON for --list-json. The value was not displayed."
);

const secretJson = '{"password":"super-secret",}';
for (const args of [
  ["profiles", "user-update", "--updates-json", secretJson],
  ["profiles", "user-update", "-j", secretJson],
  ["profiles", "user-update", `-j${secretJson}`],
  ["profiles", "user-update", `--updates-json=${secretJson}`],
]) {
  await expectLocalError(
    args,
    "Invalid JSON for --updates-json. The value was not displayed.",
    "super-secret"
  );
}

let jsonOptionCount = 0;
for (const group of root.children) {
  if (group.kind !== "group") continue;
  for (const command of group.children) {
    if (command.kind !== "command") continue;
    for (const [name, schema] of Object.entries(command.params.shape)) {
      const jsonSchema = unwrap(schema);
      if (jsonSchema.kind !== "json") continue;
      const longOption = `--${kebabCase(name)}`;
      await expectLocalError(
        [group.name, command.name, longOption, secretJson],
        `Invalid JSON for ${longOption}. The value was not displayed.`,
        "super-secret"
      );
      if (jsonSchema.short !== undefined) {
        await expectLocalError(
          [group.name, command.name, `-${jsonSchema.short}${secretJson}`],
          `Invalid JSON for ${longOption}. The value was not displayed.`,
          "super-secret"
        );
      }
      jsonOptionCount += 1;
    }
  }
}

if (jsonOptionCount < 25) {
  throw new Error(`JSON redaction sweep covered too few options: ${jsonOptionCount}`);
}
await expectLocalError(
  ["lists", "get", "--list-id", " "],
  'Invalid value for "listId": " " does not match pattern "\\S"'
);
await expectLocalError(
  ["lists", "get", "--list-id", "\u001b"],
  "Command arguments must not contain unsafe terminal formatting characters"
);
await expectLocalError(
  ["profiles", "forgot-password", "--email", "x\u001b[31m@example.com"],
  "Command arguments must not contain unsafe terminal formatting characters"
);
await expectLocalError(
  ["lists", "create", "--label", "safe\u202Etxt"],
  "Command arguments must not contain unsafe terminal formatting characters"
);
await expectLocalError(
  ["lists", "create", "--label", "safe\nInjected"],
  "Command arguments must not contain unsafe terminal formatting characters"
);
await expectLocalError(
  ["lists", "create", "--label", "safe\tInjected"],
  "Command arguments must not contain unsafe terminal formatting characters"
);
for (const separator of ["\u2028", "\u2029"]) {
  await expectLocalError(
    ["profiles", "forgot-password", "--email", `x${separator}Injected`],
    "Command arguments must not contain unsafe terminal formatting characters"
  );
}
await expectLocalError(
  [
    "tasks",
    "chore-create-simple",
    "--summary",
    "Test",
    "--start",
    "2026-07-05",
    "--recurrence-rrule",
    "RRULE:",
  ],
  "recurrenceRrule must contain a recurrence rule"
);
await expectLocalError(
  [
    "tasks",
    "chore-create-simple",
    "--summary",
    "Test",
    "--start",
    "2026-07-05",
    "--recurrence-rrule",
    "INTERVAL=2",
  ],
  "recurrenceRrule must include a non-empty FREQ component"
);
await expectLocalError(
  [
    "tasks",
    "chore-create-simple",
    "--summary",
    "Test",
    "--start",
    "2026-07-05",
    "--recurrence-rrule",
    "FREQ=NEVER",
  ],
  "recurrenceRrule contains an invalid FREQ value"
);
await expectLocalError(
  [
    "tasks",
    "chore-create-simple",
    "--summary",
    "Test",
    "--start",
    "2026-07-05",
    "--recurrence-rrule",
    "FREQ=DAILY;BROKEN",
  ],
  "recurrenceRrule contains an invalid recurrence component"
);
await expectLocalError(
  [
    "tasks",
    "chore-create-simple",
    "--summary",
    "Test",
    "--start",
    "2026-07-05",
    "--recurrence-rrule",
    "FREQ=DAILY;INTERVL=2",
  ],
  "recurrenceRrule contains an unsupported recurrence component"
);
await expectLocalError(
  [
    "tasks",
    "chore-create-simple",
    "--summary",
    "Test",
    "--start",
    "2026-07-05",
    "--recurrence-rrule",
    "FREQ=DAILY;FREQ=WEEKLY",
  ],
  "recurrenceRrule must not repeat the FREQ component"
);
await expectLocalError(
  [
    "lists",
    "item-move",
    "--list-id",
    "1",
    "--item-id",
    "2",
    "--after-item-id",
    "999999999999999999999",
  ],
  "afterItemId must be a positive safe integer"
);
