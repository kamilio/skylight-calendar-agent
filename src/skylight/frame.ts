import { UserError } from "toolcraft";
import { getSkylightConfig } from "./config.js";
import { requestJson, SkylightRequestError } from "./http.js";
import { pathSegment } from "./validation.js";

type FramesListResponse = {
  data?: Array<{
    id?: string;
    attributes?: {
      name?: string;
      household_name?: string;
    };
  }>;
};

let inFlightFrameResolution: Promise<string> | undefined;

function validateFramesListResponse(value: unknown): FramesListResponse {
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray((value as { data?: unknown }).data)
  ) {
    throw new UserError("Frame list response is missing a data array.");
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
      process.env.SKYLIGHT_FRAME_ID = fromUrl;
      return pathSegment(fromUrl, "SKYLIGHT_CALENDAR_URL frame id");
    } catch (error) {
      if (!(error instanceof SkylightRequestError) || error.status !== 404) {
        throw error;
      }
    }
  }

  const frames = await listCalendarFrames(ctx);

  const ids = (frames.data ?? [])
    .map((frame) => ({
      id: frame.id ?? "",
      name: frame.attributes?.household_name ?? frame.attributes?.name ?? "",
    }))
    .filter((frame) => frame.id.length > 0);

  if (ids.length === 1) {
    const [frame] = ids;
    if (!frame) {
      throw new UserError("Unable to infer frame id.");
    }
    process.env.SKYLIGHT_FRAME_ID = frame.id;
    return pathSegment(frame.id, "frame id");
  }

  if (ids.length === 0) {
    throw new UserError("No frames returned for this account.");
  }

  const lines = ids.map((frame) => `- ${frame.id}${frame.name ? ` (${frame.name})` : ""}`);
  throw new UserError(
    `Multiple frames found. Set SKYLIGHT_FRAME_ID.\n${lines.join("\n")}`
  );
}

export async function resolveFrameId(ctx: { fetch: typeof globalThis.fetch }): Promise<string> {
  const config = getSkylightConfig();
  const fromEnv = config.frameId?.trim();
  if (fromEnv) return pathSegment(fromEnv, "SKYLIGHT_FRAME_ID");
  if (inFlightFrameResolution !== undefined) return inFlightFrameResolution;

  const resolution = discoverFrameId(ctx, config.calendarShareId);
  inFlightFrameResolution = resolution;
  try {
    return await resolution;
  } finally {
    if (inFlightFrameResolution === resolution) inFlightFrameResolution = undefined;
  }
}
