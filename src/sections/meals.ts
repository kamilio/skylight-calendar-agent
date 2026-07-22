import { S, UserError } from "toolcraft";
import {
  defineSkylightCommand as defineCommand,
  defineSkylightGroup as defineGroup,
} from "../skylight/service.js";
import {
  assertAtLeastOneDefined,
  assertValidDateOrDateTime,
  assertValidDateRange,
  dateOrDateTimeParam,
  dateParam,
  jsonParam,
  nonBlankParam,
  normalizeIdentifier,
  parseNonEmptyJsonObject,
  parseJsonObject,
  pathSegment,
} from "../skylight/validation.js";

export const mealsGroup = defineGroup({
  name: "meals",
  description: "Meals (sittings) and meal categories",
  children: [
    defineCommand({
      name: "categories",
      description: "List meal categories",
      scope: ["cli", "mcp", "sdk"],
      effect: "read",
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
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
      effect: "destructive",
      params: S.Object({
        categoryId: nonBlankParam({ description: "Meal category id", short: "i" }),
        updatesJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "PATCH",
          path: `/api/frames/${frameId}/meals/categories/${pathSegment(ctx.params.categoryId, "categoryId")}`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "list",
      description: "List meals (sittings) for an optional date range",
      scope: ["cli", "mcp", "sdk"],
      effect: "read",
      params: S.Object({
        dateMin: S.Optional(dateParam({ description: "YYYY-MM-DD", short: "a" })),
        dateMax: S.Optional(dateParam({ description: "YYYY-MM-DD", short: "b" })),
      }),
      handler: async (ctx) => {
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
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
      effect: "read",
      params: S.Object({
        mealId: nonBlankParam({ description: "Meal sitting id", short: "i" }),
        dateMin: S.Optional(dateParam({ description: "YYYY-MM-DD", short: "a" })),
        dateMax: S.Optional(dateParam({ description: "YYYY-MM-DD", short: "b" })),
      }),
      handler: async (ctx) => {
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/meals/sittings/${pathSegment(ctx.params.mealId, "mealId")}/instances`,
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
      effect: "additive",
      params: S.Object({
        recipeId: nonBlankParam({ description: "Meal recipe id", short: "r" }),
        categoryId: nonBlankParam({ description: "Meal category id", short: "c" }),
        addToGroceryList: S.Optional(S.Boolean({ description: "Add ingredients to grocery list" })),
        extrasJson: S.Optional(
          jsonParam({ description: "Extra JSON fields to merge into body", short: "j" })
        ),
        dateMin: S.Optional(
          dateParam({ description: "Start of response refresh range; does not schedule the meal (YYYY-MM-DD)", short: "a" })
        ),
        dateMax: S.Optional(
          dateParam({ description: "End of response refresh range; does not schedule the meal (YYYY-MM-DD)", short: "b" })
        ),
      }),
      handler: async (ctx) => {
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const extras =
          ctx.params.extrasJson === undefined
            ? {}
            : parseJsonObject(ctx.params.extrasJson, "extrasJson");
        const recipeId = normalizeIdentifier(ctx.params.recipeId, "recipeId");
        const categoryId = normalizeIdentifier(ctx.params.categoryId, "categoryId");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/sittings`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            include: "meal_category,meal_recipe",
          },
          body: {
            ...extras,
            meal_recipe_id: recipeId,
            meal_category_id: categoryId,
            add_to_grocery_list: ctx.params.addToGroceryList ?? false,
          },
        });
      },
    }),
    defineCommand({
      name: "create-raw",
      description: "Create a meal sitting (raw JSON body)",
      scope: ["cli", "sdk"],
      params: S.Object({
        bodyJson: jsonParam({ description: "Raw body JSON", short: "j" }),
        dateMin: S.Optional(
          dateParam({ description: "Start of response refresh range; does not schedule the meal (YYYY-MM-DD)", short: "a" })
        ),
        dateMax: S.Optional(
          dateParam({ description: "End of response refresh range; does not schedule the meal (YYYY-MM-DD)", short: "b" })
        ),
      }),
      handler: async (ctx) => {
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const body = parseNonEmptyJsonObject(ctx.params.bodyJson, "bodyJson");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/sittings`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            include: "meal_category,meal_recipe",
          },
          body,
        });
      },
    }),
    defineCommand({
      name: "update",
      description: "Update a meal instance",
      scope: ["cli", "mcp", "sdk"],
      effect: "destructive",
      params: S.Object({
        mealId: nonBlankParam({ description: "Meal sitting id", short: "i" }),
        instanceIso: dateOrDateTimeParam({
          description: "Date or ISO datetime identifying the meal instance",
          short: "t",
        }),
        recipeId: S.Optional(nonBlankParam({ description: "Meal recipe id", short: "r" })),
        categoryId: S.Optional(nonBlankParam({ description: "Meal category id", short: "c" })),
        updatesJson: S.Optional(
          jsonParam({ description: "Extra JSON updates to merge", short: "j" })
        ),
        applyTo: S.Optional(nonBlankParam({ description: "Apply-to scope (server-defined)" })),
        dateMin: S.Optional(
          dateParam({ description: "Start of response refresh range; does not reschedule the meal (YYYY-MM-DD)", short: "a" })
        ),
        dateMax: S.Optional(
          dateParam({ description: "End of response refresh range; does not reschedule the meal (YYYY-MM-DD)", short: "b" })
        ),
      }),
      handler: async (ctx) => {
        assertAtLeastOneDefined(
          [ctx.params.recipeId, ctx.params.categoryId, ctx.params.updatesJson],
          "Specify recipeId, categoryId, or updatesJson to update the meal."
        );
        assertValidDateOrDateTime(ctx.params.instanceIso, "instanceIso");
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const updates =
          ctx.params.updatesJson === undefined
            ? {}
            : parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
        const recipeId =
          ctx.params.recipeId === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.recipeId, "recipeId");
        const categoryId =
          ctx.params.categoryId === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.categoryId, "categoryId");
        const applyTo =
          ctx.params.applyTo === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.applyTo, "applyTo");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "PATCH",
          path: `/api/frames/${frameId}/meals/sittings/${pathSegment(ctx.params.mealId, "mealId")}/instances/${pathSegment(ctx.params.instanceIso, "instanceIso")}`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            ...(applyTo === undefined ? {} : { apply_to: applyTo }),
            include: "meal_category,meal_recipe",
          },
          body: {
            ...updates,
            ...(recipeId === undefined ? {} : { meal_recipe_id: recipeId }),
            ...(categoryId === undefined ? {} : { meal_category_id: categoryId }),
          },
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a meal instance",
      scope: ["cli", "mcp", "sdk"],
      effect: "destructive",
      params: S.Object({
        mealId: nonBlankParam({ description: "Meal sitting id", short: "i" }),
        instanceIso: dateOrDateTimeParam({
          description: "Date or ISO datetime identifying the meal instance",
          short: "t",
        }),
        applyTo: S.Optional(nonBlankParam({ description: "Apply-to scope (server-defined)" })),
        dateMin: S.Optional(
          dateParam({ description: "Start of response refresh range (YYYY-MM-DD)", short: "a" })
        ),
        dateMax: S.Optional(
          dateParam({ description: "End of response refresh range (YYYY-MM-DD)", short: "b" })
        ),
      }),
      handler: async (ctx) => {
        assertValidDateOrDateTime(ctx.params.instanceIso, "instanceIso");
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const applyTo =
          ctx.params.applyTo === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.applyTo, "applyTo");
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/meals/sittings/${pathSegment(ctx.params.mealId, "mealId")}/instances/${pathSegment(ctx.params.instanceIso, "instanceIso")}`,
          query: {
            ...(ctx.params.dateMin === undefined ? {} : { date_min: ctx.params.dateMin }),
            ...(ctx.params.dateMax === undefined ? {} : { date_max: ctx.params.dateMax }),
            ...(applyTo === undefined ? {} : { apply_to: applyTo }),
            include: "meal_category,meal_recipe",
          },
        });
      },
    }),
    defineCommand({
      name: "migrate",
      description: "Migrate dinner plans",
      scope: ["cli", "sdk"],
      params: S.Object({
        confirm: S.Boolean({ description: "Confirm dinner-plan migration" }),
      }),
      handler: async (ctx) => {
        if (ctx.params.confirm !== true) {
          throw new UserError("Pass confirm=true to migrate dinner plans.");
        }
        const frameId = await ctx.skylight.resolveFrameId(ctx);
        return ctx.skylight.request({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/meals/sittings/migrate`,
        });
      },
    }),
  ],
});
