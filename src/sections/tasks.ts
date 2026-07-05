import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import {
  assertValidDate,
  assertValidDateRange,
  dateParam,
  jsonParam,
  nonBlankParam,
  normalizeRrule,
  parseNonEmptyJsonObject,
  pathSegment,
  timeParam,
} from "../skylight/validation.js";

export const tasksGroup = defineGroup({
  name: "tasks",
  description: "Chores (tasks) and task box",
  children: [
    defineCommand({
      name: "chores",
      description: "List chores for a date range",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        after: S.Optional(dateParam({ description: "YYYY-MM-DD", short: "a" })),
        before: S.Optional(dateParam({ description: "YYYY-MM-DD", short: "b" })),
        includeLate: S.Boolean({
          description: "Include late chores",
          short: "l",
          default: true,
        }),
        includeUpForGrabs: S.Boolean({
          description: "Include up-for-grabs chores",
          default: false,
        }),
      }),
      handler: async (ctx) => {
        assertValidDateRange(ctx.params.after, ctx.params.before, "after", "before");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/chores`,
          query: {
            after: ctx.params.after,
            before: ctx.params.before,
            include_late: ctx.params.includeLate,
            include_up_for_grabs: ctx.params.includeUpForGrabs,
            filter: "linked_to_profile",
          },
        });
      },
    }),
    defineCommand({
      name: "chore-create",
      description: "Create a chore via /chores/create_multiple (raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        choreJson: jsonParam({ description: "Raw chore JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const chore = parseNonEmptyJsonObject(ctx.params.choreJson, "choreJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/chores/create_multiple`,
          body: chore,
        });
      },
    }),
    defineCommand({
      name: "chore-create-jsonapi",
      description: "Create a chore via /chores (OpenAPI JSON:API shape; raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: jsonParam({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const body = parseNonEmptyJsonObject(ctx.params.bodyJson, "bodyJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/chores`,
          body,
        });
      },
    }),
    defineCommand({
      name: "chore-create-simple",
      description: "Create a simple chore (convenience wrapper)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        summary: nonBlankParam({ description: "Title", short: "s" }),
        start: dateParam({ description: "YYYY-MM-DD", short: "d" }),
        categoryId: S.Optional(nonBlankParam({ description: "Category id" })),
        rewardPoints: S.Optional(
          S.Number({ description: "Reward points", jsonType: "integer" })
        ),
        emojiIcon: S.Optional(S.String({ description: "Emoji icon" })),
        recurrenceRrule: S.Optional(
          nonBlankParam({
            description: "RRULE string (e.g. FREQ=DAILY;INTERVAL=1)",
            short: "r",
          })
        ),
      }),
      handler: async (ctx) => {
        assertValidDate(ctx.params.start, "start");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/chores/create_multiple`,
          body: {
            start: ctx.params.start,
            up_for_grabs: false,
            routine: false,
            start_time: null,
            recurrence_set:
              ctx.params.recurrenceRrule === undefined
                ? null
                : [normalizeRrule(ctx.params.recurrenceRrule, "recurrenceRrule")],
            summary: ctx.params.summary,
            recurring_until: null,
            category_ids: ctx.params.categoryId ? [ctx.params.categoryId] : [],
            reward_points: ctx.params.rewardPoints ?? null,
            emoji_icon: ctx.params.emojiIcon ?? null,
          },
        });
      },
    }),
    defineCommand({
      name: "chore-update",
      description: "Update a chore",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        choreId: nonBlankParam({ description: "Chore id", short: "i" }),
        applyTo: S.Optional(nonBlankParam({ description: "Apply-to scope (server-defined)" })),
        updatesJson: jsonParam({ description: "JSON object of updates", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/chores/${pathSegment(ctx.params.choreId, "choreId")}`,
          body: {
            ...updates,
            ...(ctx.params.applyTo === undefined ? {} : { apply_to: ctx.params.applyTo }),
          },
        });
      },
    }),
    defineCommand({
      name: "chore-delete",
      description: "Delete a chore",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        choreId: nonBlankParam({ description: "Chore id", short: "i" }),
        applyTo: S.Optional(nonBlankParam({ description: "Apply-to scope (server-defined)" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/chores/${pathSegment(ctx.params.choreId, "choreId")}`,
          query: {
            ...(ctx.params.applyTo === undefined ? {} : { apply_to: ctx.params.applyTo }),
          },
        });
      },
    }),
    defineCommand({
      name: "chore-status",
      description: "Update task completion status",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        seriesId: nonBlankParam({ description: "Chore series id", short: "i" }),
        status: nonBlankParam({ description: "Status (server-defined)", short: "s" }),
        instanceDate: dateParam({ description: "YYYY-MM-DD", short: "d" }),
        instanceTime: S.Optional(timeParam({ description: "HH:mm", short: "t" })),
        categoryId: S.Optional(nonBlankParam({ description: "Category id" })),
      }),
      handler: async (ctx) => {
        assertValidDate(ctx.params.instanceDate, "instanceDate");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/chores/${pathSegment(ctx.params.seriesId, "seriesId")}/completions`,
          body: {
            status: ctx.params.status,
            instance_date: ctx.params.instanceDate,
            instance_time: ctx.params.instanceTime ?? null,
            category_id: ctx.params.categoryId ?? null,
          },
        });
      },
    }),
    defineCommand({
      name: "taskbox-create",
      description: "Create a Task Box item",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        summary: nonBlankParam({ description: "Task summary", short: "s" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/task_box/items`,
          body: {
            data: {
              type: "task_box_item",
              attributes: { summary: ctx.params.summary },
            },
          },
        });
      },
    }),
    defineCommand({
      name: "taskbox-create-jsonapi",
      description: "Create a Task Box item (OpenAPI JSON:API shape; raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: jsonParam({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const body = parseNonEmptyJsonObject(ctx.params.bodyJson, "bodyJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/task_box/items`,
          body,
        });
      },
    }),
    defineCommand({
      name: "taskbox-list",
      description: "List Task Box items",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/task_box/items`,
        });
      },
    }),
    defineCommand({
      name: "taskbox-save",
      description: "Create or update a Task Box item (raw JSON body; include id to update)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        taskBoxItemJson: jsonParam({ description: "Raw task box item JSON", short: "j" }),
      }),
      handler: async (ctx) => {
        const taskBoxItem = parseNonEmptyJsonObject(
          ctx.params.taskBoxItemJson,
          "taskBoxItemJson"
        ) as {
          id?: unknown;
        };
        const id = taskBoxItem.id;
        let itemPath: string | undefined;
        if (id !== undefined) {
          if (typeof id !== "string" && typeof id !== "number") {
            throw new UserError("id must be a non-blank string or number when provided.");
          }
          itemPath = pathSegment(id, "id");
        }
        const frameId = await resolveFrameId(ctx);
        if (itemPath !== undefined) {
          return requestJson({
            fetch: ctx.fetch,
            method: "PATCH",
            path: `/api/frames/${frameId}/task_box/items/${itemPath}`,
            body: taskBoxItem,
          });
        }
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/task_box/items`,
          body: taskBoxItem,
        });
      },
    }),
    defineCommand({
      name: "taskbox-delete",
      description: "Delete a Task Box item",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        taskBoxItemId: nonBlankParam({ description: "Task Box item id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/task_box/items/${pathSegment(ctx.params.taskBoxItemId, "taskBoxItemId")}`,
        });
      },
    }),
  ],
});
