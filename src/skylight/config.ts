import { UserError } from "toolcraft";

export interface SkylightConfig {
  apiBaseUrl: string;
  apiVersion: string;
  calendarUrl: string;
  calendarShareId: string | null;
  frameId: string | null;
  timezone: string;
  requestTimeoutMs: number;
}

function firstNonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
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
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new UserError("SKYLIGHT_API_BASE must contain only the server origin, optionally ending in /api.");
  }
  return url.origin;
}

function normalizeTimezone(value: string): string {
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    throw new UserError(`SKYLIGHT_TIMEZONE is not a valid IANA timezone: ${timezone}`);
  }
  return timezone;
}

function parseRequestTimeout(value: string | null): number {
  if (value === null) return 30_000;
  const timeout = Number(value);
  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new UserError("SKYLIGHT_REQUEST_TIMEOUT_MS must be a positive integer.");
  }
  return timeout;
}

function parseCalendarShareId(calendarUrl: string): string | null {
  try {
    const url = new URL(calendarUrl);
    const match = url.pathname.match(/\/calendar\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function getSkylightConfig(env: NodeJS.ProcessEnv = process.env): SkylightConfig {
  const calendarUrl = firstNonEmpty(env.SKYLIGHT_CALENDAR_URL) ?? "";
  const calendarShareId = parseCalendarShareId(calendarUrl);

  const rawApiBaseUrl = firstNonEmpty(env.SKYLIGHT_API_BASE) ?? "https://app.ourskylight.com";

  return {
    apiBaseUrl: normalizeApiBaseUrl(rawApiBaseUrl),
    apiVersion: firstNonEmpty(env.SKYLIGHT_API_VERSION) ?? "2026-03-01",
    calendarUrl,
    calendarShareId,
    frameId: firstNonEmpty(env.SKYLIGHT_FRAME_ID),
    timezone: normalizeTimezone(firstNonEmpty(env.SKYLIGHT_TIMEZONE) ?? "America/Chicago"),
    requestTimeoutMs: parseRequestTimeout(firstNonEmpty(env.SKYLIGHT_REQUEST_TIMEOUT_MS)),
  };
}
