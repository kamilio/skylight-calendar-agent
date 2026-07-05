import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import {
  jsonParam,
  nonBlankParam,
  normalizeIdentifier,
  parseNonEmptyJsonObject,
  pathSegment,
  uniqueIdentifiers,
} from "../skylight/validation.js";

export const photosGroup = defineGroup({
  name: "photos",
  description: "Photos/videos (messages) and albums",
  children: [
    defineCommand({
      name: "list",
      description: "List messages (photos/videos)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        page: S.Optional(
          S.Number({
            description: "Page number (1-based)",
            default: 1,
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
            jsonType: "integer",
          })
        ),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const page = ctx.params.page ?? 1;
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages`,
          ...(page > 1 ? { query: { page } } : {}),
        });
      },
    }),
    defineCommand({
      name: "list-paged",
      description: "List messages using page_token",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        pageToken: nonBlankParam({ description: "page_token value", short: "p" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages`,
          query: { page_token: ctx.params.pageToken },
        });
      },
    }),
    defineCommand({
      name: "list-synced",
      description: "List messages using sync_token",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        syncToken: nonBlankParam({ description: "sync_token value", short: "s" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages`,
          query: { sync_token: ctx.params.syncToken },
        });
      },
    }),
    defineCommand({
      name: "delete-many",
      description: "Bulk delete messages",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageIds: S.Array(nonBlankParam({ description: "Message id" }), {
          description: "Message ids",
          minItems: 1,
        }),
      }),
      handler: async (ctx) => {
        const messageIds = uniqueIdentifiers(ctx.params.messageIds, "messageIds");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/destroy_multiple`,
          query: { "message_ids[]": messageIds },
        });
      },
    }),
    defineCommand({
      name: "copy-to-frames",
      description: "Copy messages to other frames",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageIds: S.Array(nonBlankParam({ description: "Message id" }), {
          description: "Message ids",
          minItems: 1,
        }),
        newFrameIds: S.Array(nonBlankParam({ description: "New frame id" }), {
          description: "Target frame ids",
          minItems: 1,
        }),
      }),
      handler: async (ctx) => {
        const messageIds = uniqueIdentifiers(ctx.params.messageIds, "messageIds");
        const newFrameIds = uniqueIdentifiers(ctx.params.newFrameIds, "newFrameIds");
        const encodedNewFrameIds = newFrameIds.map((newFrameId) =>
          pathSegment(newFrameId, "newFrameId")
        );
        const frameId = await resolveFrameId(ctx);
        if (encodedNewFrameIds.includes(frameId)) {
          throw new UserError("newFrameIds must not include the source frame.");
        }
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/copy_to_frames`,
          body: {
            message_ids: messageIds,
            new_frame_ids: newFrameIds,
          },
        });
      },
    }),
    defineCommand({
      name: "get",
      description: "Get message details",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}`,
        });
      },
    }),
    defineCommand({
      name: "likes",
      description: "List message likes",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}/all_likes`,
        });
      },
    }),
    defineCommand({
      name: "comments",
      description: "List message comments",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
        page: S.Optional(
          S.Number({
            description: "Page number (1-based)",
            default: 1,
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
            jsonType: "integer",
          })
        ),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const page = ctx.params.page ?? 1;
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}/comments`,
          ...(page > 1 ? { query: { page } } : {}),
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}`,
        });
      },
    }),
    defineCommand({
      name: "like",
      description: "Like a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}/likes`,
        });
      },
    }),
    defineCommand({
      name: "unlike",
      description: "Unlike a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}/likes`,
        });
      },
    }),
    defineCommand({
      name: "comment",
      description: "Comment on a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
        body: nonBlankParam({ description: "Comment body", short: "b" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}/comments`,
          body: { body: ctx.params.body },
        });
      },
    }),
    defineCommand({
      name: "comment-delete",
      description: "Delete a comment on a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "m" }),
        commentId: nonBlankParam({ description: "Comment id", short: "c" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}/comments/${pathSegment(ctx.params.commentId, "commentId")}`,
        });
      },
    }),
    defineCommand({
      name: "caption-update",
      description: "Update message caption",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: nonBlankParam({ description: "Message id", short: "i" }),
        caption: S.String({ description: "New caption", short: "c" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/messages/${pathSegment(ctx.params.messageId, "messageId")}/caption`,
          body: { caption: ctx.params.caption },
        });
      },
    }),
    defineCommand({
      name: "upload-credentials",
      description: "Get cloud upload credentials",
      scope: ["cli", "sdk"],
      params: S.Object({}),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/messages/cloud_upload_credentials`,
        }),
    }),
    defineCommand({
      name: "upload-message",
      description: "Register an uploaded message (raw fields JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        payloadJson: jsonParam({
          description: "JSON for {file_upload, frame_ids, ext, ...}",
          short: "j",
        }),
      }),
      handler: async (ctx) => {
        const payload = parseNonEmptyJsonObject(ctx.params.payloadJson, "payloadJson");
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/messages/uploads`,
          body: payload,
        });
      },
    }),
    defineCommand({
      name: "upload-url",
      description: "Create a single upload URL (raw fields JSON)",
      scope: ["cli", "sdk"],
      params: S.Object({
        payloadJson: jsonParam({ description: "JSON for {ext, frame_ids, ...}", short: "j" }),
      }),
      handler: async (ctx) => {
        const payload = parseNonEmptyJsonObject(ctx.params.payloadJson, "payloadJson");
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/upload_url`,
          body: payload,
        });
      },
    }),
    defineCommand({
      name: "upload-urls",
      description: "Create multiple upload URLs (raw fields JSON)",
      scope: ["cli", "sdk"],
      params: S.Object({
        payloadJson: jsonParam({ description: "JSON for {frame_ids, messages}", short: "j" }),
      }),
      handler: async (ctx) => {
        const payload = parseNonEmptyJsonObject(ctx.params.payloadJson, "payloadJson");
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/message_upload_urls`,
          body: payload,
        });
      },
    }),
    defineCommand({
      name: "albums",
      description: "List albums",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/albums`,
        });
      },
    }),
    defineCommand({
      name: "album-create",
      description: "Create an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        title: nonBlankParam({ description: "Album title", short: "t" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/albums`,
          body: { title: ctx.params.title },
        });
      },
    }),
    defineCommand({
      name: "album-rename",
      description: "Rename an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: nonBlankParam({ description: "Album id", short: "i" }),
        title: nonBlankParam({ description: "New title", short: "t" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/albums/${pathSegment(ctx.params.albumId, "albumId")}`,
          body: { title: ctx.params.title },
        });
      },
    }),
    defineCommand({
      name: "album-delete",
      description: "Delete an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: nonBlankParam({ description: "Album id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/albums/${pathSegment(ctx.params.albumId, "albumId")}`,
        });
      },
    }),
    defineCommand({
      name: "album-messages",
      description: "List messages in an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: nonBlankParam({ description: "Album id", short: "i" }),
        page: S.Optional(
          S.Number({
            description: "Page number (1-based)",
            default: 1,
            minimum: 1,
            maximum: Number.MAX_SAFE_INTEGER,
            jsonType: "integer",
          })
        ),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const page = ctx.params.page ?? 1;
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/albums/${pathSegment(ctx.params.albumId, "albumId")}/messages`,
          ...(page > 1 ? { query: { page } } : {}),
        });
      },
    }),
    defineCommand({
      name: "album-message-ids",
      description: "List all message ids in an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: nonBlankParam({ description: "Album id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/albums/${pathSegment(ctx.params.albumId, "albumId")}/messages/all_ids`,
        });
      },
    }),
    defineCommand({
      name: "album-add",
      description: "Add messages to album(s)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumIds: S.Array(nonBlankParam({ description: "Album id" }), {
          description: "Album ids",
          minItems: 1,
        }),
        messageIds: S.Array(nonBlankParam({ description: "Message id" }), {
          description: "Message ids",
          minItems: 1,
        }),
      }),
      handler: async (ctx) => {
        const albumIds = uniqueIdentifiers(ctx.params.albumIds, "albumIds");
        const messageIds = uniqueIdentifiers(ctx.params.messageIds, "messageIds");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/albums/add_to`,
          body: {
            album_ids: albumIds,
            message_ids: messageIds,
          },
        });
      },
    }),
    defineCommand({
      name: "album-remove",
      description: "Remove messages from an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: nonBlankParam({ description: "Album id", short: "i" }),
        messageIds: S.Array(nonBlankParam({ description: "Message id" }), {
          description: "Message ids",
          minItems: 1,
        }),
      }),
      handler: async (ctx) => {
        const albumId = normalizeIdentifier(ctx.params.albumId, "albumId");
        const messageIds = uniqueIdentifiers(ctx.params.messageIds, "messageIds");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/albums/remove_from`,
          body: {
            album_ids: [albumId],
            message_ids: messageIds,
          },
        });
      },
    }),
  ],
});
