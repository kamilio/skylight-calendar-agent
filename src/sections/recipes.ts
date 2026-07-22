import { S } from "toolcraft";
import {
  defineSkylightCommand as defineCommand,
  defineSkylightGroup as defineGroup,
} from "../skylight/service.js";
import {
  assertAtLeastOneDefined,
  boundedStringParam,
  nonBlankParam,
  normalizeIdentifier,
  pathSegment,
} from "../skylight/validation.js";

export const recipesGroup = defineGroup({
  name: "recipes",
  description: "Meal recipes",
  children: [
    defineCommand({
      name: "list",
      description: "List meal recipes",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/meals/recipes`,
          query: { include: "meal_category" },
        });
      },
    }),
    defineCommand({
      name: "get",
      description: "Get a meal recipe by id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        recipeId: nonBlankParam({ description: "Recipe id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/meals/recipes/${pathSegment(ctx.params.recipeId, "recipeId")}`,
          query: { include: "meal_category" },
        });
      },
    }),
    defineCommand({
      name: "create",
      description: "Create a meal recipe",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: nonBlankParam({ description: "Meal category id", short: "c" }),
        summary: nonBlankParam({ description: "Recipe title", short: "s" }),
        description: S.Optional(boundedStringParam({ description: "Recipe description" })),
      }),
      handler: async (ctx) => {
        const categoryId = normalizeIdentifier(ctx.params.categoryId, "categoryId");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/recipes`,
          query: { include: "meal_category" },
          body: {
            meal_category_id: categoryId,
            summary: ctx.params.summary,
            description: ctx.params.description ?? null,
          },
        });
      },
    }),
    defineCommand({
      name: "update",
      description: "Update a meal recipe",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        recipeId: nonBlankParam({ description: "Recipe id", short: "i" }),
        categoryId: S.Optional(nonBlankParam({ description: "Meal category id", short: "c" })),
        summary: S.Optional(nonBlankParam({ description: "Recipe title", short: "s" })),
        description: S.Optional(boundedStringParam({ description: "Recipe description" })),
      }),
      handler: async (ctx) => {
        assertAtLeastOneDefined(
          [ctx.params.categoryId, ctx.params.summary, ctx.params.description],
          "Specify categoryId, summary, or description to update the recipe."
        );
        const categoryId =
          ctx.params.categoryId === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.categoryId, "categoryId");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "PATCH",
          path: `/api/frames/${frameId}/meals/recipes/${pathSegment(ctx.params.recipeId, "recipeId")}`,
          query: { include: "meal_category" },
          body: {
            ...(categoryId === undefined ? {} : { meal_category_id: categoryId }),
            ...(ctx.params.summary === undefined ? {} : { summary: ctx.params.summary }),
            ...(ctx.params.description === undefined ? {} : { description: ctx.params.description }),
          },
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a meal recipe",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        recipeId: nonBlankParam({ description: "Recipe id", short: "i" }),
        includeMeals: S.Optional(S.Boolean({ description: "Apply deletion to sittings too" })),
      }),
      handler: async (ctx) => {
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/meals/recipes/${pathSegment(ctx.params.recipeId, "recipeId")}`,
          ...(ctx.params.includeMeals === true
            ? { query: { apply_to_sittings: true } }
            : {}),
        });
      },
    }),
    defineCommand({
      name: "add-to-grocery-list",
      description: "Add recipe ingredients to grocery list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        recipeId: nonBlankParam({ description: "Recipe id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/recipes/${pathSegment(ctx.params.recipeId, "recipeId")}/add_to_grocery_list`,
        });
      },
    }),
  ],
});
