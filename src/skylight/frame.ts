import { createHash } from "node:crypto";
import { UserError } from "toolcraft";
import { getSkylightConfig } from "./config.js";
import { requestJson, SkylightRequestError } from "./http.js";
import { terminalSafeText, truncateText } from "./text.js";
import { assertWellFormedUnicode, normalizeIdentifier, pathSegment } from "./validation.js";

type FramesListResponse = {
  data: Array<{
    id: string;
    attributes?: {
      name?: string;
      household_name?: string;
    };
  }>;
};

const frameResolutions = new WeakMap<
  typeof globalThis.fetch,
  Map<string, Promise<string>>
>();

function frameResolutionKey(config: ReturnType<typeof getSkylightConfig>): string {
  const env = process.env;
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.apiBaseUrl,
        config.calendarShareId,
        env.SKYLIGHT_AUTH_HEADER,
        env.SKYLIGHT_BASIC_TOKEN,
        env.SKYLIGHT_BEARER_TOKEN,
        env.SKYLIGHT_EMAIL,
        env.SKYLIGHT_PASSWORD,
      ])
    )
    .digest("hex");
}

function displayValue(value: string): string {
  const sanitized = terminalSafeText(value);
  return sanitized.length <= 200 ? sanitized : `${truncateText(sanitized, 200)}…`;
}

function validateIdentifierParams(params: unknown): void {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return;
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (name.endsWith("Ids") && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" || typeof item === "number") {
          normalizeIdentifier(item, `${name} item`);
        }
      }
      continue;
    }
    if (name.endsWith("Id") && (typeof value === "string" || typeof value === "number")) {
      normalizeIdentifier(value, name);
    }
  }
}

function validateJsonParameter(
  value: unknown,
  label: string,
  active = new WeakSet<object>(),
  visited = new WeakSet<object>()
): void {
  if (typeof value === "string") {
    assertWellFormedUnicode(value, label);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new UserError(`${label} contains a non-finite number.`);
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new UserError(`${label} contains an unsafe integer; use a string to preserve it exactly.`);
    }
    return;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    throw new UserError(`${label} contains a non-JSON value.`);
  }
  if (value === null || typeof value !== "object") return;
  if (active.has(value)) {
    throw new UserError(`${label} contains a circular reference.`);
  }
  if (visited.has(value)) return;
  active.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonParameter(item, `${label}[${index}]`, active, visited));
  } else {
    for (const [name, child] of Object.entries(value)) {
      assertWellFormedUnicode(name, `${label} property name`);
      validateJsonParameter(child, `${label}.${JSON.stringify(name)}`, active, visited);
    }
  }
  active.delete(value);
  visited.add(value);
}

function validateCommandParams(params: unknown): void {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return;
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    validateJsonParameter(value, `Command parameter ${JSON.stringify(name)}`);
  }
}

function validateFramesListResponse(value: unknown): FramesListResponse {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray((value as { data?: unknown }).data)
  ) {
    throw new UserError("Frame list response is missing a data array.");
  }
  const data = (value as { data: unknown[] }).data;
  for (const frame of data) {
    if (
      frame === null ||
      typeof frame !== "object" ||
      typeof (frame as { id?: unknown }).id !== "string" ||
      (frame as { id: string }).id.trim().length === 0
    ) {
      throw new UserError("Frame list response contains an invalid frame id.");
    }
  }
  return value as FramesListResponse;
}

export async function listCalendarFrames(ctx: {
  fetch: typeof globalThis.fetch;
}): Promise<FramesListResponse> {
  try {
    return validateFramesListResponse(await requestJson<unknown>({
      fetch: ctx.fetch,
      method: "GET",
      path: "/api/frames/calendar",
    }));
  } catch (error) {
    if (!(error instanceof SkylightRequestError) || error.status !== 404) throw error;
    return validateFramesListResponse(await requestJson<unknown>({
      fetch: ctx.fetch,
      method: "GET",
      path: "/api/frames",
    }));
  }
}

async function discoverFrameId(
  ctx: { fetch: typeof globalThis.fetch },
  calendarShareId: string | null
): Promise<string> {
  const fromUrl = calendarShareId?.trim();
  if (fromUrl) {
    try {
      await requestJson({
        fetch: ctx.fetch,
        method: "GET",
        path: `/api/frames/${pathSegment(fromUrl, "SKYLIGHT_CALENDAR_URL frame id")}`,
      });
      return pathSegment(fromUrl, "SKYLIGHT_CALENDAR_URL frame id");
    } catch (error) {
      if (!(error instanceof SkylightRequestError) || error.status !== 404) {
        throw error;
      }
    }
  }

  const frames = await listCalendarFrames(ctx);

  const ids = (frames.data ?? [])
    .map((frame) => {
      const householdName = frame.attributes?.household_name;
      const name = frame.attributes?.name;
      return {
        id: frame.id,
        name:
          typeof householdName === "string"
            ? householdName
            : typeof name === "string"
              ? name
              : "",
      };
    });

  if (ids.length === 1) {
    const [frame] = ids;
    if (!frame) {
      throw new UserError("Unable to infer frame id.");
    }
    return pathSegment(frame.id, "frame id");
  }

  if (ids.length === 0) {
    throw new UserError("No frames returned for this account.");
  }

  const lines = ids.map((frame) => {
    const id = displayValue(frame.id);
    const name = displayValue(frame.name);
    return `- ${id}${name ? ` (${name})` : ""}`;
  });
  throw new UserError(
    `Multiple frames found. Set SKYLIGHT_FRAME_ID.\n${lines.join("\n")}`
  );
}

export async function resolveFrameId(ctx: {
  fetch: typeof globalThis.fetch;
  params?: unknown;
}): Promise<string> {
  validateCommandParams(ctx.params);
  validateIdentifierParams(ctx.params);
  const config = getSkylightConfig();
  const fromEnv = config.frameId?.trim();
  if (fromEnv) return pathSegment(fromEnv, "SKYLIGHT_FRAME_ID");
  const key = frameResolutionKey(config);
  let resolutions = frameResolutions.get(ctx.fetch);
  if (resolutions === undefined) {
    resolutions = new Map();
    frameResolutions.set(ctx.fetch, resolutions);
  }
  const existing = resolutions.get(key);
  if (existing !== undefined) return existing;
  const resolution = discoverFrameId(ctx, config.calendarShareId);
  resolutions.set(key, resolution);
  try {
    return await resolution;
  } catch (error) {
    if (resolutions.get(key) === resolution) resolutions.delete(key);
    throw error;
  }
}
