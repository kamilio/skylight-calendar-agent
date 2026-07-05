import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import {
  assertValidDateTime,
  dateTimeParam,
  jsonParam,
  nonBlankParam,
  parseNonEmptyJsonObject,
  pathSegment,
} from "../skylight/validation.js";

export const rewardsGroup = defineGroup({
  name: "rewards",
  description: "Rewards and reward points",
  children: [
    defineCommand({
      name: "list",
      description: "List rewards",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        redeemedAtMin: S.Optional(
          dateTimeParam({ description: "RFC3339 datetime with Z or UTC offset", short: "m" })
        ),
        redeemedAtMax: S.Optional(
          dateTimeParam({ description: "RFC3339 datetime with Z or UTC offset", short: "x" })
        ),
      }),
      handler: async (ctx) => {
        if (ctx.params.redeemedAtMin !== undefined && ctx.params.redeemedAtMax !== undefined) {
          assertValidDateTime(ctx.params.redeemedAtMin, "redeemedAtMin");
          assertValidDateTime(ctx.params.redeemedAtMax, "redeemedAtMax");
          if (Date.parse(ctx.params.redeemedAtMin) > Date.parse(ctx.params.redeemedAtMax)) {
            throw new UserError("redeemedAtMin must not be after redeemedAtMax.");
          }
        } else if (ctx.params.redeemedAtMin !== undefined) {
          assertValidDateTime(ctx.params.redeemedAtMin, "redeemedAtMin");
        } else if (ctx.params.redeemedAtMax !== undefined) {
          assertValidDateTime(ctx.params.redeemedAtMax, "redeemedAtMax");
        }
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/rewards`,
          query: {
            redeemed_at_min: ctx.params.redeemedAtMin,
            redeemed_at_max: ctx.params.redeemedAtMax,
          },
        });
      },
    }),
    defineCommand({
      name: "get",
      description: "Get a reward by id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: nonBlankParam({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/rewards/${pathSegment(ctx.params.rewardId, "rewardId")}`,
        });
      },
    }),
    defineCommand({
      name: "create",
      description: "Create a reward (reward JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const reward = parseNonEmptyJsonObject(ctx.params.rewardJson, "rewardJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/rewards`,
          body: reward,
        });
      },
    }),
    defineCommand({
      name: "update",
      description: "Update a reward (reward JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: nonBlankParam({ description: "Reward id", short: "i" }),
        rewardJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const reward = parseNonEmptyJsonObject(ctx.params.rewardJson, "rewardJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PATCH",
          path: `/api/frames/${frameId}/rewards/${pathSegment(ctx.params.rewardId, "rewardId")}`,
          body: reward,
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a reward",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: nonBlankParam({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/rewards/${pathSegment(ctx.params.rewardId, "rewardId")}`,
        });
      },
    }),
    defineCommand({
      name: "redeem",
      description: "Redeem a reward",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: nonBlankParam({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/rewards/${pathSegment(ctx.params.rewardId, "rewardId")}/redeem`,
        });
      },
    }),
    defineCommand({
      name: "unredeem",
      description: "Unredeem a reward",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: nonBlankParam({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/rewards/${pathSegment(ctx.params.rewardId, "rewardId")}/unredeem`,
        });
      },
    }),
    defineCommand({
      name: "points",
      description: "List reward points",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/reward_points`,
        });
      },
    }),
    defineCommand({
      name: "points-add",
      description: "Add reward points to categories",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryIds: S.Array(nonBlankParam({ description: "Category id" }), {
          description: "Category ids",
          minItems: 1,
        }),
        points: S.Number({ description: "Points to add", jsonType: "integer" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/reward_points`,
          body: {
            category_ids: ctx.params.categoryIds,
            points: ctx.params.points,
          },
        });
      },
    }),
  ],
});
