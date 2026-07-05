import { defineCommand, defineGroup, S } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";

export const photosGroup = defineGroup({
  name: "photos",
  description: "Photos/videos (messages) and albums",
  children: [
    defineCommand({
      name: "list",
      description: "List messages (photos/videos)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        page: S.Optional(S.Number({ description: "Page number (1-based)", default: 1 })),
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
        pageToken: S.String({ description: "page_token value", short: "p" }),
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
        syncToken: S.String({ description: "sync_token value", short: "s" }),
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
        messageIds: S.Array(S.String({ description: "Message id" }), { description: "Message ids" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/destroy_multiple`,
          query: { "message_ids[]": ctx.params.messageIds },
        });
      },
    }),
    defineCommand({
      name: "copy-to-frames",
      description: "Copy messages to other frames",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageIds: S.Array(S.String({ description: "Message id" }), { description: "Message ids" }),
        newFrameIds: S.Array(S.String({ description: "New frame id" }), { description: "Target frame ids" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/copy_to_frames`,
          body: {
            message_ids: ctx.params.messageIds,
            new_frame_ids: ctx.params.newFrameIds,
          },
        });
      },
    }),
    defineCommand({
      name: "get",
      description: "Get message details",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}`,
        });
      },
    }),
    defineCommand({
      name: "likes",
      description: "List message likes",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}/all_likes`,
        });
      },
    }),
    defineCommand({
      name: "comments",
      description: "List message comments",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
        page: S.Optional(S.Number({ description: "Page number (1-based)", default: 1 })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const page = ctx.params.page ?? 1;
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}/comments`,
          ...(page > 1 ? { query: { page } } : {}),
        });
      },
    }),
    defineCommand({
      name: "delete",
      description: "Delete a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}`,
        });
      },
    }),
    defineCommand({
      name: "like",
      description: "Like a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}/likes`,
        });
      },
    }),
    defineCommand({
      name: "unlike",
      description: "Unlike a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}/likes`,
        });
      },
    }),
    defineCommand({
      name: "comment",
      description: "Comment on a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
        body: S.String({ description: "Comment body", short: "b" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}/comments`,
          body: { body: ctx.params.body },
        });
      },
    }),
    defineCommand({
      name: "comment-delete",
      description: "Delete a comment on a message",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "m" }),
        commentId: S.String({ description: "Comment id", short: "c" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}/comments/${ctx.params.commentId}`,
        });
      },
    }),
    defineCommand({
      name: "caption-update",
      description: "Update message caption",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        messageId: S.String({ description: "Message id", short: "i" }),
        caption: S.String({ description: "New caption", short: "c" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/messages/${ctx.params.messageId}/caption`,
          body: { caption: ctx.params.caption },
        });
      },
    }),
    defineCommand({
      name: "upload-credentials",
      description: "Get cloud upload credentials",
      scope: ["cli", "mcp", "sdk"],
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
        payloadJson: S.String({ description: "JSON for {file_upload, frame_ids, ext, ...}", short: "j" }),
      }),
      handler: async (ctx) => {
        const payload = JSON.parse(ctx.params.payloadJson) as unknown;
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
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        payloadJson: S.String({ description: "JSON for {ext, frame_ids, ...}", short: "j" }),
      }),
      handler: async (ctx) => {
        const payload = JSON.parse(ctx.params.payloadJson) as unknown;
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
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        payloadJson: S.String({ description: "JSON for {frame_ids, messages}", short: "j" }),
      }),
      handler: async (ctx) => {
        const payload = JSON.parse(ctx.params.payloadJson) as unknown;
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
        title: S.String({ description: "Album title", short: "t" }),
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
        albumId: S.String({ description: "Album id", short: "i" }),
        title: S.String({ description: "New title", short: "t" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/albums/${ctx.params.albumId}`,
          body: { title: ctx.params.title },
        });
      },
    }),
    defineCommand({
      name: "album-delete",
      description: "Delete an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: S.String({ description: "Album id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/albums/${ctx.params.albumId}`,
        });
      },
    }),
    defineCommand({
      name: "album-messages",
      description: "List messages in an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: S.String({ description: "Album id", short: "i" }),
        page: S.Optional(S.Number({ description: "Page number (1-based)", default: 1 })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const page = ctx.params.page ?? 1;
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/albums/${ctx.params.albumId}/messages`,
          ...(page > 1 ? { query: { page } } : {}),
        });
      },
    }),
    defineCommand({
      name: "album-message-ids",
      description: "List all message ids in an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: S.String({ description: "Album id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/albums/${ctx.params.albumId}/messages/all_ids`,
        });
      },
    }),
    defineCommand({
      name: "album-add",
      description: "Add messages to album(s)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumIds: S.Array(S.String({ description: "Album id" }), { description: "Album ids" }),
        messageIds: S.Array(S.String({ description: "Message id" }), { description: "Message ids" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/albums/add_to`,
          body: {
            album_ids: ctx.params.albumIds,
            message_ids: ctx.params.messageIds,
          },
        });
      },
    }),
    defineCommand({
      name: "album-remove",
      description: "Remove messages from an album",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        albumId: S.String({ description: "Album id", short: "i" }),
        messageIds: S.Array(S.String({ description: "Message id" }), { description: "Message ids" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/albums/remove_from`,
          body: {
            album_ids: [ctx.params.albumId],
            message_ids: ctx.params.messageIds,
          },
        });
      },
    }),
  ],
});
