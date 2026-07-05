export interface SkylightConfig {
  apiBaseUrl: string;
  apiVersion: string;
  calendarUrl: string;
  calendarShareId: string | null;
  frameId: string | null;
  timezone: string;
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
  return out;
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
    timezone: firstNonEmpty(env.SKYLIGHT_TIMEZONE) ?? "America/Chicago",
  };
}
