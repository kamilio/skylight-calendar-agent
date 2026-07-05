import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { getSkylightConfig } from "../skylight/config.js";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import {
  assertAtLeastOneDefined,
  assertValidAbsoluteUrl,
  assertValidDateOrDateTime,
  assertValidDateOrDateTimeRange,
  assertValidDateRange,
  assertValidTimezone,
  dateOrDateTimeParam,
  dateParam,
  emailParam,
  jsonParam,
  nonBlankParam,
  normalizeRrule,
  parseJsonContainer,
  parseJsonObject,
  parseNonEmptyJsonObject,
  pathSegment,
} from "../skylight/validation.js";

export const calendarGroup = defineGroup({
  name: "calendar",
  description: "Calendar events and source calendars",
  children: [
    defineCommand({
      name: "notification-settings",
      description: "Get event notification settings",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/event_notification_settings`,
        });
      },
    }),
    defineCommand({
      name: "notification-settings-update",
      description: "Update event notification settings",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        onTime: S.Boolean({ description: "Notify on time; use --on-time=false to disable" }),
        early: S.Boolean({ description: "Notify early; use --early=false to disable" }),
        earlyMinutesBefore: S.Optional(
          S.Number({
            description: "Minutes before the event for early notifications",
            minimum: 0,
            jsonType: "integer",
          })
        ),
      }),
      handler: async (ctx) => {
        if (ctx.params.early && ctx.params.earlyMinutesBefore === undefined) {
          throw new UserError("earlyMinutesBefore is required when early is true.");
        }
        if (!ctx.params.early && ctx.params.earlyMinutesBefore !== undefined) {
          throw new UserError("earlyMinutesBefore cannot be set when early is false.");
        }
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/event_notification_settings`,
          body: {
            on_time: ctx.params.onTime,
            early: ctx.params.early,
            early_minutes_before: ctx.params.earlyMinutesBefore ?? null,
          },
        });
      },
    }),
    defineCommand({
      name: "events",
      description: "List calendar events for a date range",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        dateMin: dateParam({ description: "YYYY-MM-DD", short: "a" }),
        dateMax: dateParam({ description: "YYYY-MM-DD", short: "b" }),
        timezone: S.Optional(S.String({ description: "IANA timezone", short: "z" })),
        include: S.Optional(
          S.String({
            description: "Comma-separated related resources; defaults to categories,calendar_account,event_notification_setting",
          })
        ),
      }),
      handler: async (ctx) => {
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const config = getSkylightConfig();
        const timezone = ctx.params.timezone ?? config.timezone;
        assertValidTimezone(timezone);
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendar_events`,
          query: {
            date_min: ctx.params.dateMin,
            date_max: ctx.params.dateMax,
            timezone,
            include:
              ctx.params.include ?? "categories,calendar_account,event_notification_setting",
          },
        });
      },
    }),
    defineCommand({
      name: "events-search",
      description: "Search calendar events",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        searchQuery: nonBlankParam({ description: "Search query", short: "q" }),
        timezone: S.Optional(S.String({ description: "IANA timezone", short: "z" })),
        include: S.Optional(
          S.String({
            description: "Comma-separated related resources; defaults to categories,calendar_account,event_notification_setting",
          })
        ),
      }),
      handler: async (ctx) => {
        const config = getSkylightConfig();
        const timezone = ctx.params.timezone ?? config.timezone;
        assertValidTimezone(timezone);
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendar_events/search`,
          query: {
            search_query: ctx.params.searchQuery,
            timezone,
            include:
              ctx.params.include ?? "categories,calendar_account,event_notification_setting",
          },
        });
      },
    }),
    defineCommand({
      name: "events-countdowns",
      description: "List countdown events",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        timezone: S.Optional(S.String({ description: "IANA timezone", short: "z" })),
        include: S.Optional(
          S.String({ description: "Comma-separated related resources to include" })
        ),
      }),
      handler: async (ctx) => {
        const config = getSkylightConfig();
        const timezone = ctx.params.timezone ?? config.timezone;
        assertValidTimezone(timezone);
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendar_events/countdowns`,
          query: {
            timezone,
            ...(ctx.params.include === undefined ? {} : { include: ctx.params.include }),
          },
        });
      },
    }),
    defineCommand({
      name: "recent-invited-emails",
      description: "List recently invited emails",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendar_events/recent_invited_emails`,
        });
      },
    }),
    defineCommand({
      name: "event-create",
      description: "Create a calendar event",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        summary: nonBlankParam({ description: "Event title", short: "s" }),
        startsAt: dateOrDateTimeParam({
          description: "ISO datetime or YYYY-MM-DD",
          short: "a",
        }),
        endsAt: S.Optional(
          dateOrDateTimeParam({ description: "ISO datetime or YYYY-MM-DD", short: "b" })
        ),
        allDay: S.Optional(S.Boolean({ description: "All day event" })),
        kind: S.Optional(nonBlankParam({ description: "Event kind (e.g., event)", short: "k" })),
        recurring: S.Optional(S.Boolean({ description: "Recurring?" })),
        rrule: S.Optional(
          nonBlankParam({ description: "RRULE string (without 'RRULE:' prefix)" })
        ),
        calendarId: S.Optional(nonBlankParam({ description: "Source calendar id" })),
        calendarAccountId: S.Optional(
          nonBlankParam({ description: "Calendar account id" })
        ),
        categoryIds: S.Optional(
          S.Array(nonBlankParam({ description: "Category id" }), { description: "Category ids" })
        ),
        invitedEmails: S.Optional(
          S.Array(emailParam({ description: "Invite email" }), { description: "Invited emails" })
        ),
        location: S.Optional(S.String({ description: "Location" })),
        lat: S.Optional(S.Number({ description: "Latitude", minimum: -90, maximum: 90 })),
        lng: S.Optional(S.Number({ description: "Longitude", minimum: -180, maximum: 180 })),
        description: S.Optional(S.String({ description: "Description" })),
        timezone: S.Optional(S.String({ description: "IANA timezone", short: "z" })),
        notificationSettingJson: S.Optional(
          jsonParam({ description: "event_notification_setting_attributes JSON", short: "n" })
        ),
        countdownEnabled: S.Optional(S.Boolean({ description: "Enable countdown" })),
      }),
      handler: async (ctx) => {
        assertValidDateOrDateTimeRange(ctx.params.startsAt, ctx.params.endsAt, "startsAt", "endsAt");
        if (ctx.params.recurring === true && ctx.params.rrule === undefined) {
          throw new UserError("rrule is required when recurring is true.");
        }
        if (ctx.params.recurring === false && ctx.params.rrule !== undefined) {
          throw new UserError("rrule cannot be set when recurring is false.");
        }
        if ((ctx.params.lat === undefined) !== (ctx.params.lng === undefined)) {
          throw new UserError("lat and lng must be provided together.");
        }
        const config = getSkylightConfig();
        const timezone = ctx.params.timezone ?? config.timezone;
        assertValidTimezone(timezone);
        const eventNotificationSettingAttributes =
          ctx.params.notificationSettingJson === undefined
            ? undefined
            : parseJsonObject(ctx.params.notificationSettingJson, "notificationSettingJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/calendar_events`,
          body: {
            summary: ctx.params.summary,
            kind: ctx.params.kind ?? "event",
            category_ids: ctx.params.categoryIds ?? [],
            starts_at: ctx.params.startsAt,
            ends_at: ctx.params.endsAt ?? null,
            all_day: ctx.params.allDay ?? false,
            rrule:
              ctx.params.rrule === undefined ? null : [normalizeRrule(ctx.params.rrule)],
            invited_emails: ctx.params.invitedEmails ?? [],
            location: ctx.params.location ?? null,
            lat: ctx.params.lat ?? null,
            lng: ctx.params.lng ?? null,
            description: ctx.params.description ?? null,
            calendar_account_id: ctx.params.calendarAccountId ?? null,
            calendar_id: ctx.params.calendarId ?? null,
            timezone,
            ...(eventNotificationSettingAttributes === undefined
              ? {}
              : { event_notification_setting_attributes: eventNotificationSettingAttributes }),
            countdown_enabled: ctx.params.countdownEnabled ?? false,
          },
        });
      },
    }),
    defineCommand({
      name: "event-edit",
      description: "Edit a calendar event",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        eventId: nonBlankParam({ description: "Event id", short: "i" }),
        summary: S.Optional(nonBlankParam({ description: "Event title", short: "s" })),
        startsAt: S.Optional(
          dateOrDateTimeParam({ description: "ISO datetime or YYYY-MM-DD", short: "a" })
        ),
        endsAt: S.Optional(
          dateOrDateTimeParam({ description: "ISO datetime or YYYY-MM-DD", short: "b" })
        ),
        allDay: S.Optional(
          S.Boolean({ description: "All day event; use --all-day=false to disable" })
        ),
        rrule: S.Optional(S.String({ description: "RRULE string (server format)" })),
        categoryIds: S.Optional(
          S.Array(nonBlankParam({ description: "Category id" }), {
            description: "Category ids",
          })
        ),
        invitedEmails: S.Optional(
          S.Array(emailParam({ description: "Invite email" }), {
            description: "Invited emails",
          })
        ),
        location: S.Optional(S.String({ description: "Location" })),
        lat: S.Optional(S.Number({ description: "Latitude", minimum: -90, maximum: 90 })),
        lng: S.Optional(S.Number({ description: "Longitude", minimum: -180, maximum: 180 })),
        description: S.Optional(S.String({ description: "Description" })),
        applyTo: S.Optional(nonBlankParam({ description: "Apply-to scope (server-defined)" })),
        timezone: S.Optional(S.String({ description: "IANA timezone", short: "z" })),
        notificationSettingJson: S.Optional(
          jsonParam({ description: "event_notification_setting_attributes JSON", short: "n" })
        ),
        countdownEnabled: S.Optional(
          S.Boolean({
            description: "Enable countdown; use --countdown-enabled=false to disable",
          })
        ),
      }),
      handler: async (ctx) => {
        assertAtLeastOneDefined(
          [
            ctx.params.summary,
            ctx.params.startsAt,
            ctx.params.endsAt,
            ctx.params.allDay,
            ctx.params.rrule,
            ctx.params.categoryIds,
            ctx.params.invitedEmails,
            ctx.params.location,
            ctx.params.lat,
            ctx.params.lng,
            ctx.params.description,
            ctx.params.timezone,
            ctx.params.notificationSettingJson,
            ctx.params.countdownEnabled,
          ],
          "Specify at least one event field to update."
        );
        if (ctx.params.startsAt !== undefined && ctx.params.endsAt !== undefined) {
          assertValidDateOrDateTimeRange(
            ctx.params.startsAt,
            ctx.params.endsAt,
            "startsAt",
            "endsAt"
          );
        } else if (ctx.params.startsAt !== undefined) {
          assertValidDateOrDateTime(ctx.params.startsAt, "startsAt");
        } else if (ctx.params.endsAt !== undefined) {
          assertValidDateOrDateTime(ctx.params.endsAt, "endsAt");
        }
        if ((ctx.params.lat === undefined) !== (ctx.params.lng === undefined)) {
          throw new UserError("lat and lng must be provided together.");
        }
        if (ctx.params.timezone !== undefined) {
          assertValidTimezone(ctx.params.timezone);
        }
        const eventNotificationSettingAttributes =
          ctx.params.notificationSettingJson === undefined
            ? undefined
            : parseJsonObject(ctx.params.notificationSettingJson, "notificationSettingJson");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/calendar_events/${pathSegment(ctx.params.eventId, "eventId")}`,
          body: {
            ...(ctx.params.summary === undefined ? {} : { summary: ctx.params.summary }),
            ...(ctx.params.startsAt === undefined ? {} : { starts_at: ctx.params.startsAt }),
            ...(ctx.params.endsAt === undefined ? {} : { ends_at: ctx.params.endsAt }),
            ...(ctx.params.allDay === undefined ? {} : { all_day: ctx.params.allDay }),
            ...(ctx.params.rrule === undefined ? {} : { rrule: ctx.params.rrule }),
            ...(ctx.params.categoryIds === undefined ? {} : { category_ids: ctx.params.categoryIds }),
            ...(ctx.params.invitedEmails === undefined ? {} : { invited_emails: ctx.params.invitedEmails }),
            ...(ctx.params.location === undefined ? {} : { location: ctx.params.location }),
            ...(ctx.params.lat === undefined ? {} : { lat: ctx.params.lat }),
            ...(ctx.params.lng === undefined ? {} : { lng: ctx.params.lng }),
            ...(ctx.params.description === undefined ? {} : { description: ctx.params.description }),
            ...(ctx.params.applyTo === undefined ? {} : { apply_to: ctx.params.applyTo }),
            ...(ctx.params.timezone === undefined ? {} : { timezone: ctx.params.timezone }),
            ...(eventNotificationSettingAttributes === undefined
              ? {}
              : { event_notification_setting_attributes: eventNotificationSettingAttributes }),
            ...(ctx.params.countdownEnabled === undefined
              ? {}
              : { countdown_enabled: ctx.params.countdownEnabled }),
          },
        });
      },
    }),
    defineCommand({
      name: "event-delete",
      description: "Delete a calendar event",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        eventId: nonBlankParam({ description: "Event id", short: "i" }),
        applyTo: S.Optional(nonBlankParam({ description: "Apply-to scope (server-defined)" })),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/calendar_events/${pathSegment(ctx.params.eventId, "eventId")}`,
          query: {
            ...(ctx.params.applyTo === undefined ? {} : { apply_to: ctx.params.applyTo }),
          },
        });
      },
    }),
    defineCommand({
      name: "calendar-accounts",
      description: "List calendar accounts",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendars`,
        });
      },
    }),
    defineCommand({
      name: "calendar-account-calendars",
      description: "List calendars from an account id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        accountId: nonBlankParam({ description: "Calendar account id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendars/${pathSegment(ctx.params.accountId, "accountId")}`,
        });
      },
    }),
    defineCommand({
      name: "calendar-account-update",
      description: "Update synced account calendars",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        accountId: nonBlankParam({ description: "Calendar account id", short: "i" }),
        activeCalendars: S.Array(nonBlankParam({ description: "Calendar id" }), {
          description: "Active calendars",
        }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/calendars/${pathSegment(ctx.params.accountId, "accountId")}`,
          body: { active_calendars: ctx.params.activeCalendars },
        });
      },
    }),
    defineCommand({
      name: "webcal-sync",
      description: "Sync a public calendar URL (webcal)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        calendarUrl: nonBlankParam({ description: "Public share URL", short: "u" }),
      }),
      handler: async (ctx) => {
        assertValidAbsoluteUrl(ctx.params.calendarUrl, "calendarUrl", [
          "http:",
          "https:",
          "webcal:",
        ]);
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/webcal_accounts`,
          body: { sync_url: ctx.params.calendarUrl },
        });
      },
    }),
    defineCommand({
      name: "webcal-urls",
      description: "List synced calendar URLs",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/webcal_accounts`,
        });
      },
    }),
    defineCommand({
      name: "sync-oauth-url",
      description: "Get OAuth authorization request URL for a provider",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        provider: nonBlankParam({ description: "Provider (server-defined)", short: "p" }),
        redirectUrl: nonBlankParam({ description: "Redirect URL", short: "r" }),
        failureRedirectUrl: nonBlankParam({ description: "Failure redirect URL", short: "f" }),
        email: S.Optional(emailParam({ description: "OAuth login-hint email", short: "e" })),
        twoWaySync: S.Optional(
          S.Boolean({ description: "Enable two-way sync", default: true })
        ),
      }),
      handler: async (ctx) => {
        assertValidAbsoluteUrl(ctx.params.redirectUrl, "redirectUrl");
        assertValidAbsoluteUrl(ctx.params.failureRedirectUrl, "failureRedirectUrl");
        const frameId = await resolveFrameId(ctx);
        const twoWaySync = ctx.params.twoWaySync ?? true;
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendars/authorization_request_url`,
          query: {
            redirect_url: ctx.params.redirectUrl,
            failure_redirect_url: ctx.params.failureRedirectUrl,
            two_way_sync: twoWaySync,
            provider: ctx.params.provider,
            ...(ctx.params.email === undefined ? {} : { login_hint: ctx.params.email }),
          },
        });
      },
    }),
    defineCommand({
      name: "source-calendars",
      description: "List source calendars",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({}),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/source_calendars`,
        });
      },
    }),
    defineCommand({
      name: "source-calendar-get",
      description: "Get a source calendar by id",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        calendarId: nonBlankParam({ description: "Source calendar id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/source_calendars/${pathSegment(ctx.params.calendarId, "calendarId")}`,
        });
      },
    }),
    defineCommand({
      name: "source-calendar-save",
      description: "Create or update a source calendar (attributes JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        calendarId: S.Optional(
          nonBlankParam({ description: "If set, updates that calendar id" })
        ),
        attributesJson: jsonParam({ description: "JSON object of attributes", short: "j" }),
      }),
      handler: async (ctx) => {
        const attributes = parseNonEmptyJsonObject(ctx.params.attributesJson, "attributesJson");
        const frameId = await resolveFrameId(ctx);
        if (ctx.params.calendarId) {
          return requestJson({
            fetch: ctx.fetch,
            method: "PUT",
            path: `/api/frames/${frameId}/source_calendars/${pathSegment(ctx.params.calendarId, "calendarId")}`,
            body: attributes,
          });
        }
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/source_calendars`,
          body: { attributes },
        });
      },
    }),
    defineCommand({
      name: "source-calendar-delete",
      description: "Delete a source calendar",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        calendarId: nonBlankParam({ description: "Source calendar id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/source_calendars/${pathSegment(ctx.params.calendarId, "calendarId")}`,
        });
      },
    }),
    defineCommand({
      name: "source-calendar-set-default",
      description: "Set a source calendar as default for new events",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        calendarId: nonBlankParam({ description: "Source calendar id", short: "i" }),
      }),
      handler: async (ctx) => {
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/source_calendars/set_default_for_new_events`,
          body: { id: ctx.params.calendarId },
        });
      },
    }),
    defineCommand({
      name: "source-calendar-link-profiles",
      description: "Link profiles/categories to a source calendar (categorizations JSON)",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        calendarId: nonBlankParam({ description: "Source calendar id", short: "i" }),
        categorizationsJson: jsonParam({
          description: "JSON array/object payload",
          short: "j",
        }),
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
          path: `/api/frames/${frameId}/source_calendars/${pathSegment(ctx.params.calendarId, "calendarId")}/source_calendar_categorizations`,
          body: { categorizations },
        });
      },
    }),
  ],
});
