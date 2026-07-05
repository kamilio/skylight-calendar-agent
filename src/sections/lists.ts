import { defineCommand, defineGroup, S } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";

export const listsGroup = defineGroup({
  name: "lists",
  description: "Lists and list items",
  children: [
    defineCommand({
      name: "list",
      description: "List lists",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/lists`,
        });
      },
    }),
    defineCommand({
      name: "get",
      description: "Get list by id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}`,
        });
      },
    }),
    defineCommand({
      name: "create",
      description: "Create a to-do or shopping list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        label: S.String({ description: "List name", short: "l" }),
        kind: S.Optional(
          S.Enum(["to_do", "shopping"] as const, {
            description: "List kind",
            short: "k",
          })
        ),
        color: S.Optional(
          S.String({ description: "Hex color, for example #A8D4D3", short: "c" })
        ),
        hideOnDevice: S.Optional(
          S.Boolean({ description: "Hide the list on Skylight devices" })
        ),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists`,
          body: {
            label: ctx.params.label,
            kind: ctx.params.kind ?? "to_do",
            color: ctx.params.color ?? "#A8D4D3",
            hide_on_device: ctx.params.hideOnDevice ?? false,
            default_grocery_list: false,
          },
        });
      },
    }),
    defineCommand({
      name: "create-raw",
      description: "Create a list from a raw JSON object",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists`,
          body: JSON.parse(ctx.params.listJson) as unknown,
        });
      },
    }),
    defineCommand({
      name: "update",
      description: "Update a list (updates JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        updatesJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const updates = JSON.parse(ctx.params.updatesJson) as unknown;
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}`,
        });
      },
    }),
    defineCommand({
      name: "items",
      description: "List list items for a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items`,
        });
      },
    }),
    defineCommand({
      name: "item-create",
      description: "Add a to-do item to a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        label: S.String({ description: "To-do text", short: "l" }),
        section: S.Optional(S.String({ description: "Optional section name", short: "s" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items`,
          body: {
            label: ctx.params.label,
            section: ctx.params.section?.trim() || null,
          },
        });
      },
    }),
    defineCommand({
      name: "items-create",
      description: "Add multiple to-do items to a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        labels: S.Array(S.String({ description: "To-do text" }), {
          description: "One or more to-do items",
        }),
        section: S.Optional(S.String({ description: "Optional section name", short: "s" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const items: unknown[] = [];
        for (const label of ctx.params.labels) {
          items.push(
            await requestJson({
              fetch: ctx.fetch,
              method: "POST",
              path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items`,
              body: {
                label,
                section: ctx.params.section?.trim() || null,
              },
            })
          );
        }
        return { items };
      },
    }),
    defineCommand({
      name: "item-create-raw",
      description: "Add a list item from a raw JSON object",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        itemJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items`,
          body: JSON.parse(ctx.params.itemJson) as unknown,
        });
      },
    }),
    defineCommand({
      name: "item-update",
      description: "Update a list item (updates JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        itemId: S.String({ description: "List item id" }),
        updatesJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const updates = JSON.parse(ctx.params.updatesJson) as unknown;
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items/${ctx.params.itemId}`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "item-delete",
      description: "Delete a list item",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        itemId: S.String({ description: "List item id" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items/${ctx.params.itemId}`,
        });
      },
    }),
    defineCommand({
      name: "item-move",
      description: "Move a list item after another item",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        itemId: S.String({ description: "List item id" }),
        afterItemId: S.Optional(S.String({ description: "After item id (omit to move to top)" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items/${ctx.params.itemId}/move`,
          body: {
            after_item_id: ctx.params.afterItemId ? Number(ctx.params.afterItemId) : null,
          },
        });
      },
    }),
    defineCommand({
      name: "items-move-section",
      description: "Bulk move items to a section",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        itemIds: S.Array(S.String({ description: "List item id" }), { description: "Item ids" }),
        section: S.Optional(S.String({ description: "Section name (omit to clear)" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items/bulk_update_section`,
          body: {
            item_ids: ctx.params.itemIds,
            section: ctx.params.section?.trim() || null,
          },
        });
      },
    }),
    defineCommand({
      name: "items-delete",
      description: "Bulk delete list items",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: S.String({ description: "List id", short: "i" }),
        itemIds: S.Array(S.String({ description: "List item id" }), { description: "Item ids" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/lists/${ctx.params.listId}/list_items/bulk_destroy`,
          body: { ids: ctx.params.itemIds },
        });
      },
    }),
  ],
});
