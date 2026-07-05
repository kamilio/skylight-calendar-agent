import { defineCommand, defineGroup, S } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";

export const mealsGroup = defineGroup({
  name: "meals",
  description: "Meals (sittings) and meal categories",
  children: [
    defineCommand({
      name: "categories",
      description: "List meal categories",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/meals/categories`,
        });
      },
    }),
    defineCommand({
      name: "category-update",
      description: "Update a meal category (updates JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: S.String({ description: "Meal category id", short: "i" }),
        updatesJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const updates = JSON.parse(ctx.params.updatesJson) as unknown;
        return requestJson({
          fetch: ctx.fetch,
          method: "PATCH",
          path: `/api/frames/${frameId}/meals/categories/${ctx.params.categoryId}`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "list",
      description: "List meals (sittings) for an optional date range",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        dateMin: S.Optional(S.String({ description: "YYYY-MM-DD", short: "a" })),
        dateMax: S.Optional(S.String({ description: "YYYY-MM-DD", short: "b" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/meals/sittings`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            include: "meal_category,meal_recipe",
          },
        });
      },
    }),
    defineCommand({
      name: "get",
      description: "Get meal instances for a sitting id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        mealId: S.String({ description: "Meal sitting id", short: "i" }),
        dateMin: S.Optional(S.String({ description: "YYYY-MM-DD", short: "a" })),
        dateMax: S.Optional(S.String({ description: "YYYY-MM-DD", short: "b" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/meals/sittings/${ctx.params.mealId}/instances`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            include: "meal_category,meal_recipe",
          },
        });
      },
    }),
    defineCommand({
      name: "create",
      description: "Create a meal sitting",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        recipeId: S.String({ description: "Meal recipe id", short: "r" }),
        categoryId: S.String({ description: "Meal category id", short: "c" }),
        addToGroceryList: S.Optional(S.Boolean({ description: "Add ingredients to grocery list" })),
        extrasJson: S.Optional(S.String({ description: "Extra JSON fields to merge into body", short: "j" })),
        dateMin: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "a" })),
        dateMax: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "b" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const extras =
          ctx.params.extrasJson === undefined
            ? {}
            : (JSON.parse(ctx.params.extrasJson) as Record<string, unknown>);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/sittings`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            include: "meal_category,meal_recipe",
          },
          body: {
            meal_recipe_id: ctx.params.recipeId,
            meal_category_id: ctx.params.categoryId,
            add_to_grocery_list: ctx.params.addToGroceryList ?? false,
            ...extras,
          },
        });
      },
    }),
    defineCommand({
      name: "create-raw",
      description: "Create a meal sitting (raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: S.String({ description: "Raw body JSON", short: "j" }),
        dateMin: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "a" })),
        dateMax: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "b" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/sittings`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            include: "meal_category,meal_recipe",
          },
          body: JSON.parse(ctx.params.bodyJson) as unknown,
        });
      },
    }),
    defineCommand({
      name: "update",
      description: "Update a meal instance",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        mealId: S.String({ description: "Meal sitting id", short: "i" }),
        instanceISO: S.String({ description: "Instance ISO (path segment)", short: "t" }),
        recipeId: S.Optional(S.String({ description: "Meal recipe id", short: "r" })),
        categoryId: S.Optional(S.String({ description: "Meal category id", short: "c" })),
        updatesJson: S.Optional(S.String({ description: "Extra JSON updates to merge", short: "j" })),
        applyTo: S.Optional(S.String({ description: "Apply-to scope (server-defined)" })),
        dateMin: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "a" })),
        dateMax: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "b" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const updates =
          ctx.params.updatesJson === undefined
            ? {}
            : (JSON.parse(ctx.params.updatesJson) as Record<string, unknown>);
        return requestJson({
          fetch: ctx.fetch,
          method: "PATCH",
          path: `/api/frames/${frameId}/meals/sittings/${ctx.params.mealId}/instances/${ctx.params.instanceISO}`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            ...(ctx.params.applyTo === undefined ? {} : { apply_to: ctx.params.applyTo }),
            include: "meal_category,meal_recipe",
          },
          body: {
            ...updates,
            ...(ctx.params.recipeId === undefined ? {} : { meal_recipe_id: ctx.params.recipeId }),
            ...(ctx.params.categoryId === undefined
              ? {}
              : { meal_category_id: ctx.params.categoryId }),
          },
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a meal instance",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        mealId: S.String({ description: "Meal sitting id", short: "i" }),
        instanceISO: S.String({ description: "Instance ISO (path segment)", short: "t" }),
        applyTo: S.Optional(S.String({ description: "Apply-to scope (server-defined)" })),
        dateMin: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "a" })),
        dateMax: S.Optional(S.String({ description: "YYYY-MM-DD (refresh range)", short: "b" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/meals/sittings/${ctx.params.mealId}/instances/${ctx.params.instanceISO}`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            ...(ctx.params.applyTo === undefined ? {} : { apply_to: ctx.params.applyTo }),
            include: "meal_category,meal_recipe",
          },
        });
      },
    }),
    defineCommand({
      name: "migrate",
      description: "Migrate dinner plans",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/sittings/migrate`,
        });
      },
    }),
  ],
});
