import { createHash } from "node:crypto";
import { UserError } from "toolcraft";
import { getSkylightConfig } from "./config.js";
import { requestJson, SkylightRequestError } from "./http.js";
import { terminalSafeText } from "./text.js";
import { pathSegment } from "./validation.js";

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
  return sanitized.length <= 200 ? sanitized : `${sanitized.slice(0, 200)}…`;
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

export async function resolveFrameId(ctx: { fetch: typeof globalThis.fetch }): Promise<string> {
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
    const frameId = await resolution;
    const currentKey = frameResolutionKey(getSkylightConfig());
    if (currentKey !== key) resolutions.set(currentKey, resolution);
    return frameId;
  } catch (error) {
    if (resolutions.get(key) === resolution) resolutions.delete(key);
    throw error;
  }
}
