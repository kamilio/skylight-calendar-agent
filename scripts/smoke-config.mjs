import { getSkylightConfig } from "../dist/skylight/config.js";

const normalized = getSkylightConfig({
  SKYLIGHT_API_BASE: "https://app.ourskylight.com/api/",
  SKYLIGHT_TIMEZONE: "America/Chicago",
});
if (normalized.apiBaseUrl !== "https://app.ourskylight.com") {
  throw new Error(`API base was not normalized: ${normalized.apiBaseUrl}`);
}

for (const [key, value] of [
  ["SKYLIGHT_API_BASE", "not-a-url"],
  ["SKYLIGHT_API_BASE", "ftp://example.com"],
  ["SKYLIGHT_API_BASE", "https://example.com/unexpected/path"],
  ["SKYLIGHT_TIMEZONE", "Not/A_Timezone"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "0"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "1.5"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "2147483648"],
  ["SKYLIGHT_REQUEST_TIMEOUT_MS", "999999999999999999999"],
  ["SKYLIGHT_CALENDAR_URL", "not-a-url"],
  ["SKYLIGHT_CALENDAR_URL", "ftp://example.com/calendar/123"],
  ["SKYLIGHT_CALENDAR_URL", "https://example.com/calendar/123abc"],
  ["SKYLIGHT_CALENDAR_URL", "https://example.com/not-a-calendar"],
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

const calendarUrl = getSkylightConfig({
  SKYLIGHT_CALENDAR_URL: "https://ourskylight.com/calendar/1234567/",
});
if (calendarUrl.calendarShareId !== "1234567") {
  throw new Error(`Calendar share id was not parsed: ${calendarUrl.calendarShareId}`);
}
