import { defineCommand, defineGroup, S } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";

export const tasksGroup = defineGroup({
  name: "tasks",
  description: "Chores (tasks) and task box",
  children: [
    defineCommand({
      name: "chores",
      description: "List chores for a date range",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        after: S.Optional(S.String({ description: "YYYY-MM-DD", short: "a" })),
        before: S.Optional(S.String({ description: "YYYY-MM-DD", short: "b" })),
        includeLate: S.Optional(S.Boolean({ description: "Include late chores", short: "l" })),
        includeUpForGrabs: S.Optional(S.Boolean({ description: "Include up-for-grabs chores" })),
      }),
      handler: async (ctx) => {
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
        choreJson: S.String({ description: "Raw chore JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/chores/create_multiple`,
          body: JSON.parse(ctx.params.choreJson) as unknown,
        });
      },
    }),
    defineCommand({
      name: "chore-create-jsonapi",
      description: "Create a chore via /chores (OpenAPI JSON:API shape; raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: S.String({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/chores`,
          body: JSON.parse(ctx.params.bodyJson) as unknown,
        });
      },
    }),
    defineCommand({
      name: "chore-create-simple",
      description: "Create a simple chore (convenience wrapper)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        summary: S.String({ description: "Title", short: "s" }),
        start: S.String({ description: "YYYY-MM-DD", short: "d" }),
        categoryId: S.Optional(S.String({ description: "Category id" })),
        rewardPoints: S.Optional(S.Number({ description: "Reward points" })),
        emojiIcon: S.Optional(S.String({ description: "Emoji icon" })),
        recurrenceRrule: S.Optional(
          S.String({ description: "RRULE string (e.g. FREQ=DAILY;INTERVAL=1)", short: "r" })
        ),
      }),
      handler: async (ctx) => {
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
            recurrence_set: ctx.params.recurrenceRrule ? [`RRULE:${ctx.params.recurrenceRrule}`] : null,
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
        choreId: S.String({ description: "Chore id", short: "i" }),
        applyTo: S.Optional(S.String({ description: "Apply-to scope (server-defined)" })),
        updatesJson: S.String({ description: "JSON object of updates", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const updates = JSON.parse(ctx.params.updatesJson) as Record<string, unknown>;
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/chores/${ctx.params.choreId}`,
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
        choreId: S.String({ description: "Chore id", short: "i" }),
        applyTo: S.Optional(S.String({ description: "Apply-to scope (server-defined)" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/chores/${ctx.params.choreId}`,
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
        seriesId: S.String({ description: "Chore series id", short: "i" }),
        status: S.String({ description: "Status (server-defined)", short: "s" }),
        instanceDate: S.String({ description: "YYYY-MM-DD", short: "d" }),
        instanceTime: S.Optional(S.String({ description: "HH:mm", short: "t" })),
        categoryId: S.Optional(S.String({ description: "Category id" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/chores/${ctx.params.seriesId}/completions`,
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
        summary: S.String({ description: "Task summary", short: "s" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/task_box/items`,
          body: { summary: ctx.params.summary },
        });
      },
    }),
    defineCommand({
      name: "taskbox-create-jsonapi",
      description: "Create a Task Box item (OpenAPI JSON:API shape; raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: S.String({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/task_box/items`,
          body: JSON.parse(ctx.params.bodyJson) as unknown,
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
        taskBoxItemJson: S.String({ description: "Raw task box item JSON", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const taskBoxItem = JSON.parse(ctx.params.taskBoxItemJson) as { id?: string | number };
        const id = taskBoxItem.id;
        if (id !== undefined && String(id).length > 0) {
          return requestJson({
            fetch: ctx.fetch,
            method: "PATCH",
            path: `/api/frames/${frameId}/task_box/items/${String(id)}`,
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
        taskBoxItemId: S.String({ description: "Task Box item id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/task_box/items/${ctx.params.taskBoxItemId}`,
        });
      },
    }),
  ],
});
