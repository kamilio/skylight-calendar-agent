import {
  getSkylightConfig,
  getSkylightFrameConfig,
  getSkylightRequestConfig,
} from "../dist/skylight/config.js";

const normalized = getSkylightConfig({
  SKYLIGHT_API_BASE: "https://app.ourskylight.com/api/",
  SKYLIGHT_TIMEZONE: "America/Chicago",
});
if (normalized.apiBaseUrl !== "https://app.ourskylight.com") {
  throw new Error(`API base was not normalized: ${normalized.apiBaseUrl}`);
}

const canonicalTimezone = getSkylightConfig({ SKYLIGHT_TIMEZONE: " us/central " });
if (canonicalTimezone.timezone !== "America/Chicago") {
  throw new Error(`Timezone was not canonicalized: ${canonicalTimezone.timezone}`);
}

for (const apiBaseUrl of [
  "http://localhost:3000",
  "http://localhost.:3000",
  "http://api.localhost.:3000",
  "http://127.0.0.1:3000",
  "http://[::1]:3000",
]) {
  if (getSkylightConfig({ SKYLIGHT_API_BASE: apiBaseUrl }).apiBaseUrl !== apiBaseUrl) {
    throw new Error(`Loopback API base was not accepted: ${apiBaseUrl}`);
  }
}

const mappedLoopback = getSkylightConfig({
  SKYLIGHT_API_BASE: "http://[::ffff:127.0.0.1]:3000",
}).apiBaseUrl;
if (mappedLoopback !== "http://[::ffff:7f00:1]:3000") {
  throw new Error(`IPv4-mapped loopback API base was not accepted: ${mappedLoopback}`);
}

const originalTimezone = process.env.TZ;
process.env.TZ = "UTC";
try {
  const defaultTimezone = getSkylightConfig({});
  if (defaultTimezone.timezone !== "UTC") {
    throw new Error(`System timezone was not used by default: ${defaultTimezone.timezone}`);
  }
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}

for (const [key, value] of [
  ["SKYLIGHT_API_BASE", "not-a-url"],
  ["SKYLIGHT_API_BASE", "ftp://example.com"],
  ["SKYLIGHT_API_BASE", "http://example.com"],
  ["SKYLIGHT_API_BASE", "http://[::ffff:8.8.8.8]"],
  ["SKYLIGHT_API_BASE", "https://example.com/unexpected/path"],
  ["SKYLIGHT_API_VERSION", "bad"],
  ["SKYLIGHT_API_VERSION", "2026-02-30"],
  ["SKYLIGHT_TIMEZONE", "Not/A_Timezone"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "0"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "1.5"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "1e3"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "0x10"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "+10"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "2147483648"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "999999999999999999999"],
  ["SKYLIGHT_CALENDAR_URL", "not-a-url"],
  ["SKYLIGHT_CALENDAR_URL", "ftp://example.com/calendar/123"],
  ["SKYLIGHT_CALENDAR_URL", "https://example.com/calendar/123abc"],
  ["SKYLIGHT_CALENDAR_URL", "https://example.com/not-a-calendar"],
  ["SKYLIGHT_FRAME_ID", "42\n"],
  ["SKYLIGHT_API_BASE", "https://example.com\n"],
  ["SKYLIGHT_API_VERSION", "2026-03-01\n"],
  ["SKYLIGHT_TIMEZONE", "UTC\n"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "1000\n"],
  ["SKYLIGHT_CALENDAR_URL", "https://ourskylight.com/calendar/123\n"],
  ["SKYLIGHT_FRAME_ID", "x".repeat(8_193)],
  ["SKYLIGHT_FRAME_ID", " ".repeat(8_193)],
]) {
  try {
    getSkylightConfig({
      SKYLIGHT_API_BASE: "https://app.ourskylight.com",
      SKYLIGHT_TIMEZONE: "America/Chicago",
      [key]: value,
    });
    throw new Error(`${key}=${value} unexpectedly succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(key)) throw error;
  }
}

try {
  getSkylightConfig({ SKYLIGHT_TIMEZONE: "Bad\u001b[31mZone" });
  throw new Error("Control-character timezone unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("\u001b") || message.includes("[31m")) {
    throw new Error(`Timezone error retained terminal controls: ${JSON.stringify(message)}`);
  }
}

const calendarUrl = getSkylightConfig({
  SKYLIGHT_CALENDAR_URL: "https://ourskylight.com/calendar/1234567/",
});
if (calendarUrl.calendarShareId !== "1234567") {
  throw new Error(`Calendar share id was not parsed: ${calendarUrl.calendarShareId}`);
}

const requestOnly = getSkylightRequestConfig({
  SKYLIGHT_API_BASE: "https://example.com",
  SKYLIGHT_TIMEZONE: "Not/A_Timezone",
  SKYLIGHT_CALENDAR_URL: "not-a-url",
});
if (requestOnly.apiBaseUrl !== "https://example.com") {
  throw new Error(`Request config was blocked by unrelated settings: ${requestOnly.apiBaseUrl}`);
}

const explicitFrame = getSkylightFrameConfig({
  SKYLIGHT_API_BASE: "https://example.com",
  SKYLIGHT_FRAME_ID: "42",
  SKYLIGHT_TIMEZONE: "Not/A_Timezone",
  SKYLIGHT_CALENDAR_URL: "not-a-url",
});
if (explicitFrame.frameId !== "42" || explicitFrame.calendarShareId !== null) {
  throw new Error(`Explicit frame config used unrelated fallbacks: ${JSON.stringify(explicitFrame)}`);
}
