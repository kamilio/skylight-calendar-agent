import { UserError } from "toolcraft";
import { assertValidDate, assertWellFormedUnicode, normalizeTimezone } from "./validation.js";

export interface SkylightConfig {
  apiBaseUrl: string;
  apiVersion: string;
  calendarUrl: string;
  calendarShareId: string | null;
  frameId: string | null;
  timezone: string;
  requestTimeoutMs: number;
}

function firstNonEmpty(value: string | undefined, label: string): string | null {
  if (value === undefined) return null;
  assertWellFormedUnicode(value, label);
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError(`${label} must not contain control characters.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeApiBaseUrl(value: string): string {
  let out = value.trim();
  while (out.endsWith("/")) out = out.slice(0, -1);
  if (out.endsWith("/api")) out = out.slice(0, -"/api".length);
  let url: URL;
  try {
    url = new URL(out);
  } catch {
    throw new UserError("SKYLIGHT_API_BASE must be a valid absolute URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError("SKYLIGHT_API_BASE must use http or https.");
  }
  const loopbackHost =
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol === "http:" && !loopbackHost) {
    throw new UserError(
      "SKYLIGHT_API_BASE must use https unless it points to localhost or a loopback address."
    );
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new UserError("SKYLIGHT_API_BASE must contain only the server origin, optionally ending in /api.");
  }
  return url.origin;
}

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function normalizeApiVersion(value: string): string {
  const version = value.trim();
  assertValidDate(version, "SKYLIGHT_API_VERSION");
  return version;
}

function parseRequestTimeout(value: string | null): number {
  if (value === null) return 30_000;
  if (!/^\d+$/.test(value)) {
    throw new UserError(
      "SKYLIGHT_REQUEST_TIMEOUT_MS must be an integer from 1 to 2147483647."
    );
  }
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new UserError(
      "SKYLIGHT_REQUEST_TIMEOUT_MS must be an integer from 1 to 2147483647."
    );
  }
  return timeout;
}

function parseCalendarShareId(calendarUrl: string): string | null {
  if (calendarUrl.length === 0) return null;
  let url: URL;
  try {
    url = new URL(calendarUrl);
  } catch {
    throw new UserError("SKYLIGHT_CALENDAR_URL must be a valid absolute URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError("SKYLIGHT_CALENDAR_URL must use http or https.");
  }
  const match = url.pathname.match(/\/calendar\/(\d+)(?:\/|$)/);
  if (!match) {
    throw new UserError("SKYLIGHT_CALENDAR_URL must contain a numeric /calendar/<id> path.");
  }
  return match[1] ?? null;
}

export function getSkylightConfig(env: NodeJS.ProcessEnv = process.env): SkylightConfig {
  const calendarUrl = firstNonEmpty(env.SKYLIGHT_CALENDAR_URL, "SKYLIGHT_CALENDAR_URL") ?? "";
  const calendarShareId = parseCalendarShareId(calendarUrl);

  const rawApiBaseUrl =
    firstNonEmpty(env.SKYLIGHT_API_BASE, "SKYLIGHT_API_BASE") ??
    "https://app.ourskylight.com";

  return {
    apiBaseUrl: normalizeApiBaseUrl(rawApiBaseUrl),
    apiVersion: normalizeApiVersion(
      firstNonEmpty(env.SKYLIGHT_API_VERSION, "SKYLIGHT_API_VERSION") ?? "2026-03-01"
    ),
    calendarUrl,
    calendarShareId,
    frameId: firstNonEmpty(env.SKYLIGHT_FRAME_ID, "SKYLIGHT_FRAME_ID"),
    timezone: normalizeTimezone(
      firstNonEmpty(env.SKYLIGHT_TIMEZONE, "SKYLIGHT_TIMEZONE") ?? systemTimezone(),
      "SKYLIGHT_TIMEZONE"
    ),
    requestTimeoutMs: parseRequestTimeout(
      firstNonEmpty(env.SKYLIGHT_REQUEST_TIMEOUT_MS, "SKYLIGHT_REQUEST_TIMEOUT_MS")
    ),
  };
}
