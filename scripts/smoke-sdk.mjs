import { createSkylightSDK } from "../dist/index.js";

const savedEnv = { ...process.env };
let calls = 0;
let requestBody;
let requestUrl;

try {
  process.env.SKYLIGHT_API_BASE = "https://example.invalid";
  process.env.SKYLIGHT_AUTH_HEADER = "Bearer test";
  process.env.SKYLIGHT_FRAME_ID = "42";
  process.env.SKYLIGHT_PASSWORD = " env secret ";

  const sdk = createSkylightSDK({
    fetch: async (url, init) => {
      calls += 1;
      requestUrl = String(url);
      requestBody = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      return Response.json({ ok: true });
    },
  });

  for (const [invoke, expected, forbidden] of [
    [
      () => sdk.profiles.userUpdate({ updatesJson: "super-secret" }),
      "updatesJson must be valid JSON. The value was not displayed.",
      "super-secret",
    ],
    [() => sdk.photos.list({ page: Infinity }), 'Invalid value for "page"'],
    [
      () => sdk.rewards.pointsAdd({ categoryIds: ["1"], points: Number.NaN }),
      'Invalid value for "points"',
    ],
    [
      () => sdk.profiles.userDelete({ confirm: false }),
      "Pass confirm=true to permanently delete the user account",
    ],
    [
      () => sdk.profiles.frameTransfer({ email: "new-owner@example.com", confirm: false }),
      "Pass confirm=true to transfer frame ownership",
    ],
    [
      () => sdk.tasks.taskboxSave({ taskBoxItemJson: { id: Number.NaN, summary: "x" } }),
      "Numeric id must be a safe integer",
    ],
    [
      () =>
        sdk.tasks.choreCreateSimple({
          summary: "Invalid recurrence",
          start: "2026-07-05",
          recurrenceRrule: "INTERVAL=2",
        }),
      "recurrenceRrule must include a non-empty FREQ component",
    ],
    [
      () =>
        sdk.tasks.choreCreateSimple({
          summary: "Invalid count",
          start: "2026-07-05",
          recurrenceRrule: "FREQ=DAILY;COUNT=banana",
        }),
      "recurrenceRrule contains an invalid COUNT value",
    ],
    [
      () =>
        sdk.tasks.choreCreateSimple({
          summary: "Invalid weekday",
          start: "2026-07-05",
          recurrenceRrule: "FREQ=WEEKLY;BYDAY=XX",
        }),
      "recurrenceRrule contains an invalid BYDAY value",
    ],
    [
      () =>
        sdk.tasks.choreCreateSimple({
          summary: "Invalid month",
          start: "2026-07-05",
          recurrenceRrule: "FREQ=MONTHLY;BYMONTH=99",
        }),
      "recurrenceRrule contains an invalid BYMONTH value",
    ],
    [
      () =>
        sdk.tasks.choreCreateSimple({
          summary: "Invalid interval",
          start: "2026-07-05",
          recurrenceRrule: "FREQ=DAILY;INTERVAL=0",
        }),
      "recurrenceRrule contains an invalid INTERVAL value",
    ],
    [
      () =>
        sdk.tasks.choreCreateSimple({
          summary: "Conflicting end",
          start: "2026-07-05",
          recurrenceRrule: "FREQ=DAILY;COUNT=2;UNTIL=20260731",
        }),
      "recurrenceRrule must not include both COUNT and UNTIL",
    ],
    [
      () =>
        sdk.tasks.choreCreateSimple({
          summary: "Oversized rule",
          start: "2026-07-05",
          recurrenceRrule: `FREQ=safe\u202E${"x".repeat(100_000)}`,
        }),
      "recurrenceRrule contains an invalid FREQ value",
      ["\u202E", "x".repeat(1_000)],
    ],
    [
      () => sdk.tasks.taskboxSave({ taskBoxItemJson: { id: Infinity, summary: "x" } }),
      "Numeric id must be a safe integer",
    ],
    [
      () => sdk.tasks.taskboxSave({ taskBoxItemJson: { id: 9_007_199_254_740_992, summary: "x" } }),
      "Numeric id must be a safe integer",
    ],
    [
      () => sdk.lists.createRaw({ listJson: { label: Number.NaN } }),
      'Command parameter "listJson"."label" contains a non-finite number',
    ],
    [
      () => sdk.lists.createRaw({ listJson: { id: 9_007_199_254_740_992 } }),
      'Command parameter "listJson"."id" contains an unsafe integer',
    ],
    [
      () => sdk.lists.createRaw({ listJson: { metadata: { when: new Date() } } }),
      'Command parameter "listJson"."metadata"."when" contains a non-JSON object',
    ],
    [
      () => sdk.lists.createRaw({ listJson: { metadata: { values: new Map() } } }),
      'Command parameter "listJson"."metadata"."values" contains a non-JSON object',
    ],
    [
      () => {
        const key = `safe\u202E${"x".repeat(100_000)}`;
        return sdk.lists.createRaw({ listJson: { [key]: Number.NaN } });
      },
      'Command parameter "listJson"."safe ',
      ["\u202E", "x".repeat(1_000)],
    ],
    [
      () => {
        let value = {};
        for (let depth = 0; depth < 101; depth += 1) value = { child: value };
        return sdk.lists.createRaw({ listJson: value });
      },
      "JSON input exceeds the maximum nesting depth of 100",
    ],
    [
      () => {
        const values = [];
        values[4_294_967_295] = "ignored";
        return sdk.lists.createRaw({ listJson: { values } });
      },
      'Command parameter "listJson"."values" contains a non-JSON array property',
    ],
    [
      () =>
        sdk.lists.createRaw({
          listJson: {
            value: new Proxy({}, { ownKeys: () => { throw new Error("super-secret"); } }),
          },
        }),
      'Command parameter "listJson"."value" could not be inspected as JSON',
      "super-secret",
    ],
    [
      () => sdk.lists.createRaw({ listJson: { label: "\uD800" } }),
      'Command parameter "listJson"."label" contains invalid Unicode',
    ],
    [
      () => sdk.profiles.ownerProfileUpdate({ birthday: "02/31" }),
      "birthday must be a valid MM/DD date",
    ],
    [
      () => sdk.profiles.ownerProfileUpdate({ birthday: "99/99" }),
      'Invalid value for "birthday"',
    ],
    [
      () => sdk.profiles.forgotPassword({ email: "a\u0000@b.com" }),
      'Invalid value for "email"',
    ],
    [
      () => sdk.profiles.categoryDelete({ categoryId: "7", reassignToCategoryId: " 7 " }),
      "reassignToCategoryId must differ from categoryId",
    ],
    [
      () => sdk.lists.itemMove({ listId: "1", itemId: "7", afterItemId: "7" }),
      "afterItemId must differ from itemId",
    ],
    [
      () => sdk.rewards.pointsAdd({ categoryIds: ["7", " 7 "], points: 10 }),
      "categoryIds must not contain duplicates",
    ],
    [
      () => sdk.photos.copyToFrames({ messageIds: ["1", " 1 "], newFrameIds: ["8"] }),
      "messageIds must not contain duplicates",
    ],
    [
      () => sdk.photos.copyToFrames({ messageIds: ["1"], newFrameIds: ["8", " 8 "] }),
      "newFrameIds must not contain duplicates",
    ],
    [
      () => sdk.photos.copyToFrames({ messageIds: ["1"], newFrameIds: ["42"] }),
      "newFrameIds must not include the source frame",
    ],
    [
      () => sdk.photos.deleteMany({ messageIds: ["1", " 1 "] }),
      "messageIds must not contain duplicates",
    ],
    [
      () => sdk.photos.albumAdd({ albumIds: ["2", " 2 "], messageIds: ["1"] }),
      "albumIds must not contain duplicates",
    ],
    [
      () => sdk.photos.albumRemove({ albumId: "2", messageIds: ["1", " 1 "] }),
      "messageIds must not contain duplicates",
    ],
    [
      () => sdk.lists.itemsMoveSection({ listId: "1", itemIds: ["3", " 3 "] }),
      "itemIds must not contain duplicates",
    ],
    [
      () => sdk.lists.itemsDelete({ listId: "1", itemIds: ["3", " 3 "] }),
      "itemIds must not contain duplicates",
    ],
    [
      () => sdk.calendar.calendarAccountUpdate({ accountId: "a", activeCalendars: ["c", " c "] }),
      "activeCalendars must not contain duplicates",
    ],
    [
      () =>
        sdk.calendar.eventEdit({
          eventId: "event-1",
          categoryIds: ["4"],
          clearCategories: true,
        }),
      "categoryIds cannot be set when clearCategories is true",
    ],
    [
      () =>
        sdk.calendar.calendarAccountUpdate({
          accountId: "a",
          activeCalendars: ["c"],
          clearActiveCalendars: true,
        }),
      "activeCalendars cannot be set when clearActiveCalendars is true",
    ],
    [
      () =>
        sdk.calendar.eventCreate({
          summary: "Event",
          startsAt: "2026-07-05",
          categoryIds: ["4", " 4 "],
        }),
      "categoryIds must not contain duplicates",
    ],
    [
      () =>
        sdk.calendar.eventCreate({
          summary: "Event",
          startsAt: "2026-07-05",
          invitedEmails: ["a@example.com", "a@example.com"],
        }),
      "invitedEmails must not contain duplicates",
    ],
    [
      () =>
        sdk.calendar.eventCreate({
          summary: "Event",
          startsAt: "2026-07-05",
          invitedEmails: ["Person@example.com", "person@example.com"],
        }),
      "invitedEmails must not contain duplicates",
    ],
    [
      () =>
        sdk.calendar.eventEdit({
          eventId: "event-1",
          invitedEmails: ["a@example.com", "a@example.com"],
        }),
      "invitedEmails must not contain duplicates",
    ],
    [
      () => sdk.lists.get({ listId: "\n42" }),
      "listId must not contain control characters",
    ],
    [
      () => sdk.calendar.webcalSync({ calendarUrl: "https://example.com/calendar.ics\n" }),
      "calendarUrl must not contain control characters",
    ],
    [
      () => sdk.calendar.eventEdit({ eventId: "event-1", rrule: "\nFREQ=DAILY" }),
      "rrule must not contain control characters",
    ],
    [
      () => sdk.lists.itemCreate({ listId: "1", label: "Item", section: "\nHouse" }),
      "section must not contain control characters",
    ],
  ]) {
    try {
      await invoke();
      throw new Error("Invalid SDK call unexpectedly succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(expected)) throw error;
      const forbiddenValues =
        forbidden === undefined ? [] : Array.isArray(forbidden) ? forbidden : [forbidden];
      if (forbiddenValues.some((value) => message.includes(value))) {
        throw new Error(`Invalid SDK call exposed an unsafe value: ${message}`);
      }
    }
  }
  if (calls !== 0) throw new Error(`Invalid SDK calls reached fetch ${calls} times`);

  await sdk.lists.createRaw({ listJson: { label: "Native SDK JSON" } });
  if (calls !== 1 || requestBody?.label !== "Native SDK JSON") {
    throw new Error(`Native SDK JSON was not preserved: ${JSON.stringify(requestBody)}`);
  }

  await sdk.profiles.updateEmail({ email: "new@example.com" });
  if (calls !== 2 || requestBody?.password !== " env secret ") {
    throw new Error("SDK email update did not use SKYLIGHT_PASSWORD exactly");
  }

  await sdk.meals.delete({ mealId: "meal-1", instanceIso: "2026-07-05" });
  if (calls !== 3) throw new Error("SDK meal instance parameter was not accepted");

  await sdk.profiles.deviceCreate({ name: "Kitchen", categoryId: " 7 ", role: " display " });
  if (calls !== 4 || requestBody?.category_id !== "7" || requestBody?.role !== "display") {
    throw new Error(`Typed body identifier was not normalized: ${JSON.stringify(requestBody)}`);
  }

  const taskBoxItem = { id: " 7 ", summary: "Pack lunch" };
  await sdk.tasks.taskboxSave({ taskBoxItemJson: taskBoxItem });
  if (
    calls !== 5 ||
    !requestUrl?.endsWith("/api/frames/42/task_box/items/7") ||
    requestBody?.id !== "7" ||
    taskBoxItem.id !== " 7 "
  ) {
    throw new Error(`Task Box update id was not consistently normalized: ${JSON.stringify({ requestUrl, requestBody, taskBoxItem })}`);
  }

  process.env.SKYLIGHT_TIMEZONE = "Not/A_Timezone";
  process.env.SKYLIGHT_CALENDAR_URL = "not-a-url";
  await sdk.lists.list({});
  if (calls !== 6) throw new Error("Unrelated calendar settings blocked a list request");

  await sdk.calendar.events({
    dateMin: "2026-07-01",
    dateMax: "2026-07-31",
    timezone: "UTC",
    include: " categories, calendar_account ",
  });
  if (
    calls !== 7 ||
    new URL(requestUrl).searchParams.get("include") !== "categories,calendar_account"
  ) {
    throw new Error("Calendar include resources were not normalized");
  }

  const failingSdk = createSkylightSDK({
    fetch: async () => new Response("failed", { status: 500 }),
  });
  try {
    await failingSdk.lists.itemsCreate({
      listId: "1",
      labels: [`safe\u202E${"x".repeat(100_000)}`],
    });
    throw new Error("Oversized partial failure unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.length > 2_500 || message.includes("\u202E") || !message.includes("…")) {
      throw new Error(`Partial failure label was not safely bounded: ${message.length}`);
    }
  }
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}
