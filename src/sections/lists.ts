import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import { terminalSafeText, truncateText } from "../skylight/text.js";
import {
  assertWellFormedUnicode,
  jsonParam,
  nonBlankParam,
  parseNonEmptyJsonObject,
  parsePositiveSafeInteger,
  pathSegment,
  positiveIntegerStringParam,
  uniqueIdentifiers,
} from "../skylight/validation.js";

function normalizeSection(value: string | undefined): string | null {
  if (value === undefined) return null;
  assertWellFormedUnicode(value, "section");
  if (/[\u0000-\u001F\u007F-\u009F]/.test(value)) {
    throw new UserError("section must not contain control characters.");
  }
  return value.trim() || null;
}

function displayLabel(value: string): string {
  const safe = terminalSafeText(value);
  return safe.length <= 200 ? safe : `${truncateText(safe, 200)}…`;
}

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
        listId: nonBlankParam({ description: "List id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}`,
        });
      },
    }),
    defineCommand({
      name: "create",
      description: "Create a to-do or shopping list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        label: nonBlankParam({ description: "List name", short: "l" }),
        kind: S.Optional(
          S.Enum(["to_do", "shopping"] as const, {
            description: "List kind",
            short: "k",
          })
        ),
        color: S.Optional(
          S.String({
            description: "Six-digit hex color, for example A8D4D3 or #A8D4D3",
            short: "c",
            pattern: "^#?[0-9A-Fa-f]{6}$",
          })
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
            color:
              ctx.params.color === undefined
                ? "#A8D4D3"
                : ctx.params.color.startsWith("#")
                  ? ctx.params.color
                  : `#${ctx.params.color}`,
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
        listJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const list = parseNonEmptyJsonObject(ctx.params.listJson, "listJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists`,
          body: list,
        });
      },
    }),
    defineCommand({
      name: "update",
      description: "Update a list (updates JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        updatesJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}`,
        });
      },
    }),
    defineCommand({
      name: "items",
      description: "List list items for a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items`,
        });
      },
    }),
    defineCommand({
      name: "item-create",
      description: "Add a to-do item to a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        label: nonBlankParam({ description: "To-do text", short: "l" }),
        section: S.Optional(S.String({ description: "Optional section name", short: "s" })),
      }),
      handler: async (ctx) => {
        const section = normalizeSection(ctx.params.section);
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items`,
          body: {
            label: ctx.params.label,
            section,
          },
        });
      },
    }),
    defineCommand({
      name: "items-create",
      description: "Add multiple to-do items to a list",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        labels: S.Array(nonBlankParam({ description: "To-do text" }), {
          description: "One or more to-do items",
          minItems: 1,
        }),
        section: S.Optional(S.String({ description: "Optional section name", short: "s" })),
      }),
      handler: async (ctx) => {
        const section = normalizeSection(ctx.params.section);
        const frameId = await resolveFrameId(ctx);
        const items: unknown[] = [];
        for (const [index, label] of ctx.params.labels.entries()) {
          try {
            items.push(
              await requestJson({
                fetch: ctx.fetch,
                method: "POST",
                path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items`,
                body: {
                  label,
                  section,
                },
              })
            );
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new UserError(
              `Created ${index} of ${ctx.params.labels.length} items. Failed on item ${index + 1} (${JSON.stringify(displayLabel(label))}): ${detail}`
            );
          }
        }
        return { items };
      },
    }),
    defineCommand({
      name: "item-create-raw",
      description: "Add a list item from a raw JSON object",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        itemJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const item = parseNonEmptyJsonObject(ctx.params.itemJson, "itemJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items`,
          body: item,
        });
      },
    }),
    defineCommand({
      name: "item-update",
      description: "Update a list item (updates JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        itemId: nonBlankParam({ description: "List item id" }),
        updatesJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items/${pathSegment(ctx.params.itemId, "itemId")}`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "item-delete",
      description: "Delete a list item",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        itemId: nonBlankParam({ description: "List item id" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items/${pathSegment(ctx.params.itemId, "itemId")}`,
        });
      },
    }),
    defineCommand({
      name: "item-move",
      description: "Move a list item after another item",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        itemId: nonBlankParam({ description: "List item id" }),
        afterItemId: S.Optional(
          positiveIntegerStringParam({ description: "After item id (omit to move to top)" })
        ),
      }),
      handler: async (ctx) => {
        if (ctx.params.afterItemId?.trim() === ctx.params.itemId.trim()) {
          throw new UserError("afterItemId must differ from itemId.");
        }
        const afterItemId =
          ctx.params.afterItemId === undefined
            ? null
            : parsePositiveSafeInteger(ctx.params.afterItemId, "afterItemId");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items/${pathSegment(ctx.params.itemId, "itemId")}/move`,
          body: {
            after_item_id: afterItemId,
          },
        });
      },
    }),
    defineCommand({
      name: "items-move-section",
      description: "Bulk move items to a section",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        itemIds: S.Array(nonBlankParam({ description: "List item id" }), {
          description: "Item ids",
          minItems: 1,
        }),
        section: S.Optional(S.String({ description: "Section name (omit to clear)" })),
      }),
      handler: async (ctx) => {
        const itemIds = uniqueIdentifiers(ctx.params.itemIds, "itemIds");
        const section = normalizeSection(ctx.params.section);
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items/bulk_update_section`,
          body: {
            item_ids: itemIds,
            section,
          },
        });
      },
    }),
    defineCommand({
      name: "items-delete",
      description: "Bulk delete list items",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        listId: nonBlankParam({ description: "List id", short: "i" }),
        itemIds: S.Array(nonBlankParam({ description: "List item id" }), {
          description: "Item ids",
          minItems: 1,
        }),
      }),
      handler: async (ctx) => {
        const itemIds = uniqueIdentifiers(ctx.params.itemIds, "itemIds");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/lists/${pathSegment(ctx.params.listId, "listId")}/list_items/bulk_destroy`,
          body: { ids: itemIds },
        });
      },
    }),
  ],
});
