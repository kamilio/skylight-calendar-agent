import { defineCommand, defineGroup, S } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";

export const rewardsGroup = defineGroup({
  name: "rewards",
  description: "Rewards and reward points",
  children: [
    defineCommand({
      name: "list",
      description: "List rewards",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        redeemedAtMin: S.Optional(S.String({ description: "ISO datetime", short: "m" })),
        redeemedAtMax: S.Optional(S.String({ description: "ISO datetime", short: "x" })),
      }),
      handler: async (ctx) => {
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
        rewardId: S.String({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/rewards/${ctx.params.rewardId}`,
        });
      },
    }),
    defineCommand({
      name: "create",
      description: "Create a reward (reward JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const reward = JSON.parse(ctx.params.rewardJson) as unknown;
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
        rewardId: S.String({ description: "Reward id", short: "i" }),
        rewardJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const reward = JSON.parse(ctx.params.rewardJson) as unknown;
        return requestJson({
          fetch: ctx.fetch,
          method: "PATCH",
          path: `/api/frames/${frameId}/rewards/${ctx.params.rewardId}`,
          body: reward,
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a reward",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: S.String({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/rewards/${ctx.params.rewardId}`,
        });
      },
    }),
    defineCommand({
      name: "redeem",
      description: "Redeem a reward",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: S.String({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/rewards/${ctx.params.rewardId}/redeem`,
        });
      },
    }),
    defineCommand({
      name: "unredeem",
      description: "Unredeem a reward",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        rewardId: S.String({ description: "Reward id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/rewards/${ctx.params.rewardId}/unredeem`,
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
        categoryIds: S.Array(S.String({ description: "Category id" }), {
          description: "Category ids",
        }),
        points: S.Number({ description: "Points to add" }),
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
