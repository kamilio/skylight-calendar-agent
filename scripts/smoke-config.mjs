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
