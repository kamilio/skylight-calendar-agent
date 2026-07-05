import { defineCommand, defineGroup, S } from "toolcraft";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import { getAuthorizationHeader } from "../skylight/auth.js";
import {
  nonBlankParam,
  parseJsonObject,
  parseJsonValue,
  pathSegment,
} from "../skylight/validation.js";

export const profilesGroup = defineGroup({
  name: "profiles",
  description: "Account + household profile endpoints",
  children: [
    defineCommand({
      name: "token",
      description: "Log in and print the Authorization header value",
      scope: ["cli", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const header = await getAuthorizationHeader({ fetch: ctx.fetch });
        return { authorization: header };
      },
    }),
    defineCommand({
      name: "user",
      description: "Get current user",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: "/api/user",
        }),
    }),
    defineCommand({
      name: "user-update",
      description: "Update user profile (updates JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        updatesJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseJsonObject(ctx.params.updatesJson, "updatesJson");
        return requestJson({
          fetch: ctx.fetch,
          method: "PATCH",
          path: "/api/user/profile",
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "notification-preference",
      description: "Update user notification preference",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        preference: S.String({ description: "Preference string (server-defined)", short: "p" }),
      }),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "PATCH",
          path: "/api/user/push_toggler",
          body: { notification_preference: ctx.params.preference },
        }),
    }),
    defineCommand({
      name: "marketing-preference",
      description: "Update user marketing preference",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        agree: S.Boolean({ description: "Agree to marketing?", short: "a" }),
      }),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "PATCH",
          path: "/api/user/klaviyo_toggler",
          body: { agreed_to_marketing: ctx.params.agree },
        }),
    }),
    defineCommand({
      name: "forgot-password",
      description: "Request password reset email",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        email: S.String({ description: "Email address", short: "e" }),
      }),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: "/api/password_resets",
          body: { email: ctx.params.email, on_mobile: true },
        }),
    }),
    defineCommand({
      name: "update-email",
      description: "Update user email (requires password)",
      scope: ["cli", "sdk"],
      params: S.Object({
        email: S.String({ description: "New email", short: "e" }),
        password: S.String({ description: "Current password", short: "p" }),
      }),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: "/api/user",
          body: { email: ctx.params.email, password: ctx.params.password },
        }),
    }),
    defineCommand({
      name: "discount-code",
      description: "Request referral/discount code",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: "/api/user/referral_code",
        }),
    }),
    defineCommand({
      name: "plus-access",
      description: "Get Skylight Plus subscription access",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: "/api/plus_access",
        }),
    }),
    defineCommand({
      name: "plus-resend-entitlement-email",
      description: "Resend Plus entitlement email",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: "/api/plus_access/resend_entitlement_email",
        }),
    }),
    defineCommand({
      name: "user-delete",
      description: "Delete user account",
      scope: ["cli", "sdk"],
      params: S.Object({}),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: "/api/user",
        }),
    }),
    defineCommand({
      name: "user-export",
      description: "Request user data export",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: "/api/user/export",
        }),
    }),
    defineCommand({
      name: "frames",
      description: "List frames for this account",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        type: S.Optional(S.String({ description: "Optional type (e.g. calendar, photo)" })),
      }),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: ctx.params.type ? `/api/frames/${pathSegment(ctx.params.type, "type")}` : "/api/frames",
        }),
    }),
    defineCommand({
      name: "frame",
      description: "Get configured frame info",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}`,
        });
      },
    }),
    defineCommand({
      name: "frame-update",
      description: "Update frame settings (raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: S.String({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}`,
          body: parseJsonObject(ctx.params.bodyJson, "bodyJson"),
        });
      },
    }),
    defineCommand({
      name: "frame-rename",
      description: "Rename frame",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        name: nonBlankParam({ description: "New name", short: "n" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/rename`,
          body: { name: ctx.params.name },
        });
      },
    }),
    defineCommand({
      name: "frame-hide",
      description: "Hide frame",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/hide`,
        });
      },
    }),
    defineCommand({
      name: "frame-transfer",
      description: "Transfer frame ownership to a new user email",
      scope: ["cli", "sdk"],
      params: S.Object({
        email: S.String({ description: "New owner email", short: "e" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/transfer_to_new_user`,
          body: { email: ctx.params.email },
        });
      },
    }),
    defineCommand({
      name: "frame-share-token-redeem",
      description: "Redeem a share token for this frame",
      scope: ["cli", "sdk"],
      params: S.Object({
        shareToken: S.String({ description: "Share token", short: "t" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/share_token_redemptions`,
          body: { share_token: ctx.params.shareToken },
        });
      },
    }),
    defineCommand({
      name: "owner-profile-update",
      description: "Update household owner profile",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        name: S.Optional(S.String({ description: "Owner name" })),
        birthday: S.Optional(S.String({ description: "Birthday (server format)" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/profile`,
          body: {
            ...(ctx.params.name === undefined ? {} : { name: ctx.params.name }),
            ...(ctx.params.birthday === undefined ? {} : { birthday: ctx.params.birthday }),
          },
        });
      },
    }),
    defineCommand({
      name: "categories",
      description: "List categories",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/categories`,
        });
      },
    }),
    defineCommand({
      name: "category-get",
      description: "Get a category by id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: S.String({ description: "Category id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/categories/${pathSegment(ctx.params.categoryId, "categoryId")}`,
        });
      },
    }),
    defineCommand({
      name: "category-create",
      description: "Create a category (raw JSON body; selected_for_chore_chart may mirror linked_to_profile)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: S.String({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/categories`,
          body: parseJsonObject(ctx.params.bodyJson, "bodyJson"),
        });
      },
    }),
    defineCommand({
      name: "category-find-or-create",
      description: "Find or create a category (raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        bodyJson: S.String({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/categories/find_or_create`,
          body: parseJsonObject(ctx.params.bodyJson, "bodyJson"),
        });
      },
    }),
    defineCommand({
      name: "category-update",
      description: "Update a category (raw JSON updates)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: S.String({ description: "Category id", short: "i" }),
        updatesJson: S.String({ description: "Raw JSON updates", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/categories/${pathSegment(ctx.params.categoryId, "categoryId")}`,
          body: parseJsonObject(ctx.params.updatesJson, "updatesJson"),
        });
      },
    }),
    defineCommand({
      name: "category-delete",
      description: "Delete a category",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: S.String({ description: "Category id", short: "i" }),
        reassignToCategoryId: S.Optional(S.String({ description: "Reassign items to this category id" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/categories/${pathSegment(ctx.params.categoryId, "categoryId")}`,
          query: {
            ...(ctx.params.reassignToCategoryId === undefined
              ? {}
              : { reassign_to_category_id: ctx.params.reassignToCategoryId }),
          },
        });
      },
    }),
    defineCommand({
      name: "category-link-source-calendars",
      description: "Link source calendars to a profile category (categorizations JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: S.String({ description: "Category id", short: "i" }),
        categorizationsJson: S.String({ description: "JSON payload", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const categorizations = parseJsonValue(
          ctx.params.categorizationsJson,
          "categorizationsJson"
        );
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/categories/${pathSegment(ctx.params.categoryId, "categoryId")}/source_calendar_categorizations`,
          body: { categorizations },
        });
      },
    }),
    defineCommand({
      name: "family-member-update",
      description: "Update a family member (category-backed) (updates JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: S.String({ description: "Category id", short: "i" }),
        updatesJson: S.String({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        const updates = parseJsonObject(ctx.params.updatesJson, "updatesJson");
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/categories/${pathSegment(ctx.params.categoryId, "categoryId")}/family_member`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "devices",
      description: "List devices",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/devices`,
        });
      },
    }),
    defineCommand({
      name: "device-get",
      description: "Get a device by id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        deviceId: S.String({ description: "Device id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/devices/${pathSegment(ctx.params.deviceId, "deviceId")}`,
        });
      },
    }),
    defineCommand({
      name: "device-create",
      description: "Create a device",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        name: nonBlankParam({ description: "Device name", short: "n" }),
        categoryId: S.String({ description: "Category id", short: "c" }),
        role: S.Optional(S.String({ description: "Role (server-defined)" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/devices`,
          body: {
            name: ctx.params.name,
            category_id: ctx.params.categoryId,
            ...(ctx.params.role === undefined ? {} : { role: ctx.params.role }),
          },
        });
      },
    }),
    defineCommand({
      name: "device-rename",
      description: "Rename a device",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        deviceId: S.String({ description: "Device id", short: "i" }),
        name: nonBlankParam({ description: "New name", short: "n" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/devices/${pathSegment(ctx.params.deviceId, "deviceId")}`,
          body: { name: ctx.params.name },
        });
      },
    }),
    defineCommand({
      name: "device-delete",
      description: "Delete a device",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        deviceId: S.String({ description: "Device id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/devices/${pathSegment(ctx.params.deviceId, "deviceId")}`,
        });
      },
    }),
    defineCommand({
      name: "device-reset",
      description: "Reset a device",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        deviceId: S.String({ description: "Device id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/devices/${pathSegment(ctx.params.deviceId, "deviceId")}/reset`,
        });
      },
    }),
    defineCommand({
      name: "device-activation-code",
      description: "Get a device activation code",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        deviceId: S.String({ description: "Device id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/devices/${pathSegment(ctx.params.deviceId, "deviceId")}/activation_code`,
        });
      },
    }),
    defineCommand({
      name: "device-update-settings",
      description: "Update device settings (raw JSON body)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        deviceId: S.String({ description: "Device id", short: "i" }),
        bodyJson: S.String({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/devices/${pathSegment(ctx.params.deviceId, "deviceId")}`,
          body: parseJsonObject(ctx.params.bodyJson, "bodyJson"),
        });
      },
    }),
  ],
});
