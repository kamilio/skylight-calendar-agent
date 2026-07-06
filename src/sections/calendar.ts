import { defineCommand, defineGroup, S, UserError } from "toolcraft";
import { getSkylightTimezone } from "../skylight/config.js";
import { resolveFrameId } from "../skylight/frame.js";
import { requestJson } from "../skylight/http.js";
import {
  assertAtLeastOneDefined,
  assertValidDateOrDateTime,
  assertValidDateOrDateTimeRange,
  assertValidDateRange,
  boundedArrayParam,
  boundedStringParam,
  dateOrDateTimeParam,
  dateParam,
  emailParam,
  jsonParam,
  nonBlankParam,
  normalizeAbsoluteUrl,
  normalizeIdentifier,
  normalizeRrule,
  normalizeTimezone,
  parseJsonContainer,
  parseNonEmptyJsonObject,
  pathSegment,
  uniqueIdentifiers,
} from "../skylight/validation.js";

function uniqueInvitedEmails(emails: readonly string[] | undefined): string[] | undefined {
  if (emails === undefined) return undefined;
  const normalized = emails.map((email) => email.trim());
  if (new Set(normalized.map((email) => email.toLowerCase())).size !== normalized.length) {
    throw new UserError("invitedEmails must not contain duplicates.");
  }
  return normalized;
}

function normalizeInclude(value: string): string {
  return uniqueIdentifiers(value.split(","), "include").join(",");
}

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
            maximum: Number.MAX_SAFE_INTEGER,
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
        timezone: S.Optional(boundedStringParam({ description: "IANA timezone", short: "z" })),
        include: S.Optional(
          boundedStringParam({
            description: "Comma-separated related resources; defaults to categories,calendar_account,event_notification_setting",
          })
        ),
      }),
      handler: async (ctx) => {
        assertValidDateRange(ctx.params.dateMin, ctx.params.dateMax, "dateMin", "dateMax");
        const timezone = normalizeTimezone(ctx.params.timezone ?? getSkylightTimezone());
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendar_events`,
          query: {
            date_min: ctx.params.dateMin,
            date_max: ctx.params.dateMax,
            timezone,
            include: normalizeInclude(
              ctx.params.include ?? "categories,calendar_account,event_notification_setting"
            ),
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
        timezone: S.Optional(boundedStringParam({ description: "IANA timezone", short: "z" })),
        include: S.Optional(
          boundedStringParam({
            description: "Comma-separated related resources; defaults to categories,calendar_account,event_notification_setting",
          })
        ),
      }),
      handler: async (ctx) => {
        const timezone = normalizeTimezone(ctx.params.timezone ?? getSkylightTimezone());
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendar_events/search`,
          query: {
            search_query: ctx.params.searchQuery,
            timezone,
            include: normalizeInclude(
              ctx.params.include ?? "categories,calendar_account,event_notification_setting"
            ),
          },
        });
      },
    }),
    defineCommand({
      name: "events-countdowns",
      description: "List countdown events",
      scope: ["cli", "mcp", "sdk"],
      params: S.Object({
        timezone: S.Optional(boundedStringParam({ description: "IANA timezone", short: "z" })),
        include: S.Optional(
          boundedStringParam({ description: "Comma-separated related resources to include" })
        ),
      }),
      handler: async (ctx) => {
        const timezone = normalizeTimezone(ctx.params.timezone ?? getSkylightTimezone());
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendar_events/countdowns`,
          query: {
            timezone,
            ...(ctx.params.include === undefined
              ? {}
              : { include: normalizeInclude(ctx.params.include) }),
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
        rrule: S.Optional(
          nonBlankParam({ description: "RRULE string (without 'RRULE:' prefix)" })
        ),
        calendarId: S.Optional(nonBlankParam({ description: "Source calendar id" })),
        calendarAccountId: S.Optional(
          nonBlankParam({ description: "Calendar account id" })
        ),
        categoryIds: S.Optional(
          boundedArrayParam(nonBlankParam({ description: "Category id" }), { description: "Category ids" })
        ),
        invitedEmails: S.Optional(
          boundedArrayParam(emailParam({ description: "Invite email" }), { description: "Invited emails" })
        ),
        location: S.Optional(boundedStringParam({ description: "Location" })),
        lat: S.Optional(S.Number({ description: "Latitude", minimum: -90, maximum: 90 })),
        lng: S.Optional(S.Number({ description: "Longitude", minimum: -180, maximum: 180 })),
        description: S.Optional(boundedStringParam({ description: "Description" })),
        timezone: S.Optional(boundedStringParam({ description: "IANA timezone", short: "z" })),
        notificationSettingJson: S.Optional(
          jsonParam({ description: "event_notification_setting_attributes JSON", short: "n" })
        ),
        countdownEnabled: S.Optional(S.Boolean({ description: "Enable countdown" })),
      }),
      handler: async (ctx) => {
        assertValidDateOrDateTimeRange(ctx.params.startsAt, ctx.params.endsAt, "startsAt", "endsAt");
        if ((ctx.params.lat === undefined) !== (ctx.params.lng === undefined)) {
          throw new UserError("lat and lng must be provided together.");
        }
        const timezone = normalizeTimezone(ctx.params.timezone ?? getSkylightTimezone());
        const eventNotificationSettingAttributes =
          ctx.params.notificationSettingJson === undefined
            ? undefined
            : parseNonEmptyJsonObject(
                ctx.params.notificationSettingJson,
                "notificationSettingJson"
              );
        const invitedEmails = uniqueInvitedEmails(ctx.params.invitedEmails);
        const categoryIds = uniqueIdentifiers(ctx.params.categoryIds ?? [], "categoryIds");
        const calendarAccountId =
          ctx.params.calendarAccountId === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.calendarAccountId, "calendarAccountId");
        const calendarId =
          ctx.params.calendarId === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.calendarId, "calendarId");
        const kind =
          ctx.params.kind === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.kind, "kind");
        const recurrenceRule =
          ctx.params.rrule === undefined ? null : [normalizeRrule(ctx.params.rrule)];
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/calendar_events`,
          body: {
            summary: ctx.params.summary,
            kind: kind ?? "event",
            category_ids: categoryIds,
            starts_at: ctx.params.startsAt,
            ends_at: ctx.params.endsAt ?? null,
            all_day: ctx.params.allDay ?? false,
            rrule: recurrenceRule,
            invited_emails: invitedEmails ?? [],
            location: ctx.params.location ?? null,
            lat: ctx.params.lat ?? null,
            lng: ctx.params.lng ?? null,
            description: ctx.params.description ?? null,
            calendar_account_id: calendarAccountId ?? null,
            calendar_id: calendarId ?? null,
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
        rrule: S.Optional(nonBlankParam({ description: "RRULE string" })),
        categoryIds: S.Optional(
          boundedArrayParam(nonBlankParam({ description: "Category id" }), {
            description: "Category ids",
          })
        ),
        clearCategories: S.Optional(
          S.Boolean({ description: "Remove all event categories" })
        ),
        invitedEmails: S.Optional(
          boundedArrayParam(emailParam({ description: "Invite email" }), {
            description: "Invited emails",
          })
        ),
        clearInvitedEmails: S.Optional(
          S.Boolean({ description: "Remove all invited emails" })
        ),
        location: S.Optional(boundedStringParam({ description: "Location" })),
        lat: S.Optional(S.Number({ description: "Latitude", minimum: -90, maximum: 90 })),
        lng: S.Optional(S.Number({ description: "Longitude", minimum: -180, maximum: 180 })),
        description: S.Optional(boundedStringParam({ description: "Description" })),
        applyTo: S.Optional(nonBlankParam({ description: "Apply-to scope (server-defined)" })),
        timezone: S.Optional(boundedStringParam({ description: "IANA timezone", short: "z" })),
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
        if (ctx.params.clearCategories === true && ctx.params.categoryIds !== undefined) {
          throw new UserError("categoryIds cannot be set when clearCategories is true.");
        }
        if (ctx.params.clearInvitedEmails === true && ctx.params.invitedEmails !== undefined) {
          throw new UserError("invitedEmails cannot be set when clearInvitedEmails is true.");
        }
        const categoryIds =
          ctx.params.clearCategories === true
            ? []
            : ctx.params.categoryIds === undefined
              ? undefined
              : uniqueIdentifiers(ctx.params.categoryIds, "categoryIds");
        const invitedEmails =
          ctx.params.clearInvitedEmails === true
            ? []
            : uniqueInvitedEmails(ctx.params.invitedEmails);
        assertAtLeastOneDefined(
          [
            ctx.params.summary,
            ctx.params.startsAt,
            ctx.params.endsAt,
            ctx.params.allDay,
            ctx.params.rrule,
            categoryIds,
            invitedEmails,
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
        const timezone =
          ctx.params.timezone === undefined
            ? undefined
            : normalizeTimezone(ctx.params.timezone);
        const recurrenceRule =
          ctx.params.rrule === undefined ? undefined : normalizeRrule(ctx.params.rrule);
        const applyTo =
          ctx.params.applyTo === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.applyTo, "applyTo");
        const eventNotificationSettingAttributes =
          ctx.params.notificationSettingJson === undefined
            ? undefined
            : parseNonEmptyJsonObject(
                ctx.params.notificationSettingJson,
                "notificationSettingJson"
              );
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
            ...(recurrenceRule === undefined ? {} : { rrule: recurrenceRule }),
            ...(categoryIds === undefined ? {} : { category_ids: categoryIds }),
            ...(invitedEmails === undefined ? {} : { invited_emails: invitedEmails }),
            ...(ctx.params.location === undefined ? {} : { location: ctx.params.location }),
            ...(ctx.params.lat === undefined ? {} : { lat: ctx.params.lat }),
            ...(ctx.params.lng === undefined ? {} : { lng: ctx.params.lng }),
            ...(ctx.params.description === undefined ? {} : { description: ctx.params.description }),
            ...(applyTo === undefined ? {} : { apply_to: applyTo }),
            ...(timezone === undefined ? {} : { timezone }),
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
        const applyTo =
          ctx.params.applyTo === undefined
            ? undefined
            : normalizeIdentifier(ctx.params.applyTo, "applyTo");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "DELETE",
          path: `/api/frames/${frameId}/calendar_events/${pathSegment(ctx.params.eventId, "eventId")}`,
          query: {
            ...(applyTo === undefined ? {} : { apply_to: applyTo }),
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
        activeCalendars: S.Optional(
          boundedArrayParam(nonBlankParam({ description: "Calendar id" }), {
            description: "Active calendars",
          })
        ),
        clearActiveCalendars: S.Optional(
          S.Boolean({ description: "Deactivate all calendars for this account" })
        ),
      }),
      handler: async (ctx) => {
        if (ctx.params.clearActiveCalendars === true && ctx.params.activeCalendars !== undefined) {
          throw new UserError(
            "activeCalendars cannot be set when clearActiveCalendars is true."
          );
        }
        const activeCalendars =
          ctx.params.clearActiveCalendars === true
            ? []
            : ctx.params.activeCalendars === undefined
              ? undefined
              : uniqueIdentifiers(ctx.params.activeCalendars, "activeCalendars");
        if (activeCalendars === undefined) {
          throw new UserError("Specify activeCalendars or set clearActiveCalendars=true.");
        }
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "PUT",
          path: `/api/frames/${frameId}/calendars/${pathSegment(ctx.params.accountId, "accountId")}`,
          body: { active_calendars: activeCalendars },
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
        const calendarUrl = normalizeAbsoluteUrl(ctx.params.calendarUrl, "calendarUrl", [
          "http:",
          "https:",
          "webcal:",
        ]);
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/webcal_accounts`,
          body: { sync_url: calendarUrl },
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
      scope: ["cli", "sdk"],
      params: S.Object({
        provider: nonBlankParam({ description: "Provider (server-defined)", short: "p" }),
        redirectUrl: nonBlankParam({ description: "Redirect URL", short: "r" }),
        failureRedirectUrl: nonBlankParam({ description: "Failure redirect URL", short: "f" }),
        email: S.Optional(emailParam({ description: "OAuth login-hint email", short: "e" })),
        twoWaySync: S.Optional(
          S.Boolean({ description: "Whether two-way sync is enabled", default: true })
        ),
      }),
      handler: async (ctx) => {
        const provider = normalizeIdentifier(ctx.params.provider, "provider");
        const redirectUrl = normalizeAbsoluteUrl(ctx.params.redirectUrl, "redirectUrl", [
          "http:",
          "https:",
        ]);
        const failureRedirectUrl = normalizeAbsoluteUrl(
          ctx.params.failureRedirectUrl,
          "failureRedirectUrl",
          ["http:", "https:"]
        );
        const frameId = await resolveFrameId(ctx);
        const twoWaySync = ctx.params.twoWaySync ?? true;
        return requestJson({
          fetch: ctx.fetch,
          method: "GET",
          path: `/api/frames/${frameId}/calendars/authorization_request_url`,
          query: {
            redirect_url: redirectUrl,
            failure_redirect_url: failureRedirectUrl,
            two_way_sync: twoWaySync,
            provider,
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
        const calendarId = normalizeIdentifier(ctx.params.calendarId, "calendarId");
        const frameId = await resolveFrameId(ctx);
        return requestJson({
          fetch: ctx.fetch,
          method: "POST",
          path: `/api/frames/${frameId}/source_calendars/set_default_for_new_events`,
          body: { id: calendarId },
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
