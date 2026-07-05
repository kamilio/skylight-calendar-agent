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

export async function resolveFrameId(ctx: { fetch: typeof globalThis.fetch }): Promise<string> {
  const config = getSkylightConfig();
  const fromEnv = config.frameId?.trim();
  if (fromEnv) return pathSegment(fromEnv, "SKYLIGHT_FRAME_ID");

  const fromUrl = config.calendarShareId?.trim();
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

  const frames = await requestJson<FramesListResponse>({
    fetch: ctx.fetch,
    method: "GET",
    path: "/api/frames",
  });

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
