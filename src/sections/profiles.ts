import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { listCalendarFrames, resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import { getAuthorizationHeader } from "../skylight/auth.js";
import {
  assertAtLeastOneDefined,
  assertValidMonthDay,
  emailParam,
  jsonParam,
  monthDayParam,
  nonBlankParam,
  normalizeIdentifier,
  parseJsonContainer,
  parseNonEmptyJsonObject,
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
        updatesJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
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
        preference: nonBlankParam({ description: "Preference string (server-defined)", short: "p" }),
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
        agree: S.Boolean({
          description: "Agree to marketing; use --agree=false to opt out",
          short: "a",
        }),
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
      scope: ["cli", "sdk"],
      params: S.Object({
        email: emailParam({ description: "Email address", short: "e" }),
      }),
      handler: async (ctx) =>
        requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: "/api/password_resets",
          authenticated: false,
          body: { email: ctx.params.email, on_mobile: true },
        }),
    }),
    defineCommand({
      name: "update-email",
      description: "Update user email (requires password)",
      scope: ["cli", "sdk"],
      params: S.Object({
        email: emailParam({ description: "New email", short: "e" }),
        password: S.Optional(
          S.String({
            description: "Current password; omit to use SKYLIGHT_PASSWORD",
            short: "p",
            minLength: 1,
          })
        ),
      }),
      handler: async (ctx) => {
        const password = ctx.params.password ?? process.env.SKYLIGHT_PASSWORD;
        if (password === undefined || password.length === 0) {
          throw new UserError("Set SKYLIGHT_PASSWORD or pass password to update the email.");
        }
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: "/api/user",
          body: { email: ctx.params.email, password },
        });
      },
    }),
    defineCommand({
      name: "discount-code",
      description: "Request referral/discount code",
      scope: ["cli", "sdk"],
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
      scope: ["cli", "sdk"],
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
      description: "Permanently delete the user account",
      scope: ["cli", "sdk"],
      params: S.Object({
        confirm: S.Boolean({ description: "Confirm permanent account deletion" }),
      }),
      handler: async (ctx) => {
        if (ctx.params.confirm !== true) {
          throw new UserError("Pass confirm=true to permanently delete the user account.");
        }
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: "/api/user",
        });
      },
    }),
    defineCommand({
      name: "user-export",
      description: "Request user data export",
      scope: ["cli", "sdk"],
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
      description: "List frames for this account (defaults to calendar frames)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        type: S.Optional(
          S.Enum(["calendar", "photo", "tv"] as const, {
            description: "Frame type: calendar, photo, or tv",
            short: "t",
          })
        ),
      }),
      handler: async (ctx) => {
        if (ctx.params.type === undefined || ctx.params.type === "calendar") {
          return listCalendarFrames(ctx);
        }
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${ctx.params.type}`,
        });
      },
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
        bodyJson: jsonParam({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const body = parseNonEmptyJsonObject(ctx.params.bodyJson, "bodyJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}`,
          body,
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
      scope: ["cli", "sdk"],
      params: S.Object({
        confirm: S.Boolean({ description: "Confirm hiding the configured frame" }),
      }),
      handler: async (ctx) => {
        if (ctx.params.confirm !== true) {
          throw new UserError("Pass confirm=true to hide the configured frame.");
        }
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
        email: emailParam({ description: "New owner email", short: "e" }),
        confirm: S.Boolean({ description: "Confirm transferring frame ownership" }),
      }),
      handler: async (ctx) => {
        if (ctx.params.confirm !== true) {
          throw new UserError("Pass confirm=true to transfer frame ownership.");
        }
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
        shareToken: nonBlankParam({ description: "Share token", short: "t" }),
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
        name: S.Optional(nonBlankParam({ description: "Owner name" })),
        birthday: S.Optional(monthDayParam({ description: "Birthday in MM/DD format" })),
      }),
      handler: async (ctx) => {
        assertAtLeastOneDefined(
          [ctx.params.name, ctx.params.birthday],
          "Specify name or birthday to update the owner profile."
        );
        if (ctx.params.birthday !== undefined) {
          assertValidMonthDay(ctx.params.birthday, "birthday");
        }
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
        categoryId: nonBlankParam({ description: "Category id", short: "i" }),
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
        bodyJson: jsonParam({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const body = parseNonEmptyJsonObject(ctx.params.bodyJson, "bodyJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/categories`,
          body,
        });
      },
    }),
    defineCommand({
      name: "category-find-or-create",
      description: "Find or create a category (raw JSON body)",
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
          path: `/api/frames/${frameId}/categories/find_or_create`,
          body,
        });
      },
    }),
    defineCommand({
      name: "category-update",
      description: "Update a category (raw JSON updates)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: nonBlankParam({ description: "Category id", short: "i" }),
        updatesJson: jsonParam({ description: "Raw JSON updates", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/categories/${pathSegment(ctx.params.categoryId, "categoryId")}`,
          body: updates,
        });
      },
    }),
    defineCommand({
      name: "category-delete",
      description: "Delete a category",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: nonBlankParam({ description: "Category id", short: "i" }),
        reassignToCategoryId: S.Optional(
          nonBlankParam({ description: "Reassign items to this category id" })
        ),
      }),
      handler: async (ctx) => {
        const categoryId = normalizeIdentifier(ctx.params.categoryId, "categoryId");
        const reassignToCategoryId =
          ctx.params.reassignToCategoryId === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.reassignToCategoryId, "reassignToCategoryId");
        if (reassignToCategoryId === categoryId) {
          throw new UserError("reassignToCategoryId must differ from categoryId.");
        }
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/categories/${pathSegment(categoryId, "categoryId")}`,
          query: {
            ...(reassignToCategoryId === undefined
              ? {}
              : { reassign_to_category_id: reassignToCategoryId }),
          },
        });
      },
    }),
    defineCommand({
      name: "category-link-source-calendars",
      description: "Link source calendars to a profile category (categorizations JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        categoryId: nonBlankParam({ description: "Category id", short: "i" }),
        categorizationsJson: jsonParam({ description: "JSON payload", short: "j" }),
      }),
      handler: async (ctx) => {
        const categorizations = parseJsonContainer(
          ctx.params.categorizationsJson,
          "categorizationsJson"
        );
        const frameId = await resolveFrameId(ctx);
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
        categoryId: nonBlankParam({ description: "Category id", short: "i" }),
        updatesJson: jsonParam({ description: "JSON object", short: "j" }),
      }),
      handler: async (ctx) => {
        const updates = parseNonEmptyJsonObject(ctx.params.updatesJson, "updatesJson");
        const frameId = await resolveFrameId(ctx);
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
        deviceId: nonBlankParam({ description: "Device id", short: "i" }),
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
        categoryId: nonBlankParam({ description: "Category id", short: "c" }),
        role: S.Optional(nonBlankParam({ description: "Role (server-defined)" })),
      }),
      handler: async (ctx) => {
        const categoryId = normalizeIdentifier(ctx.params.categoryId, "categoryId");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/devices`,
          body: {
            name: ctx.params.name,
            category_id: categoryId,
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
        deviceId: nonBlankParam({ description: "Device id", short: "i" }),
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
      scope: ["cli", "sdk"],
      params: S.Object({
        deviceId: nonBlankParam({ description: "Device id", short: "i" }),
        confirm: S.Boolean({ description: "Confirm deleting the device" }),
      }),
      handler: async (ctx) => {
        if (ctx.params.confirm !== true) {
          throw new UserError("Pass confirm=true to delete the device.");
        }
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
      scope: ["cli", "sdk"],
      params: S.Object({
        deviceId: nonBlankParam({ description: "Device id", short: "i" }),
        confirm: S.Boolean({ description: "Confirm resetting the device" }),
      }),
      handler: async (ctx) => {
        if (ctx.params.confirm !== true) {
          throw new UserError("Pass confirm=true to reset the device.");
        }
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
      scope: ["cli", "sdk"],
      params: S.Object({
        deviceId: nonBlankParam({ description: "Device id", short: "i" }),
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
        deviceId: nonBlankParam({ description: "Device id", short: "i" }),
        bodyJson: jsonParam({ description: "Raw JSON body", short: "j" }),
      }),
      handler: async (ctx) => {
        const body = parseNonEmptyJsonObject(ctx.params.bodyJson, "bodyJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/devices/${pathSegment(ctx.params.deviceId, "deviceId")}`,
          body,
        });
      },
    }),
  ],
});
