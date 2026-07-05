import { createSDK } from "toolcraft/sdk";
import { root } from "../dist/root.js";

const savedEnv = { ...process.env };
let calls = 0;
let requestBody;

try {
  process.env.SKYLIGHT_API_BASE = "https://example.invalid";
  process.env.SKYLIGHT_AUTH_HEADER = "Bearer test";
  process.env.SKYLIGHT_FRAME_ID = "42";
  process.env.SKYLIGHT_PASSWORD = " env secret ";

  const sdk = createSDK(root, {
    fetch: async (_url, init) => {
      calls += 1;
      requestBody = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      return Response.json({ ok: true });
    },
  });

  for (const [invoke, expected] of [
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
      () => sdk.tasks.taskboxSave({ taskBoxItemJson: { id: Infinity, summary: "x" } }),
      "Numeric id must be a safe integer",
    ],
    [
      () => sdk.tasks.taskboxSave({ taskBoxItemJson: { id: 9_007_199_254_740_992, summary: "x" } }),
      "Numeric id must be a safe integer",
    ],
    [
      () => sdk.lists.createRaw({ listJson: { label: Number.NaN } }),
      "Request body contains a non-finite number",
    ],
    [
      () => sdk.lists.createRaw({ listJson: { id: 9_007_199_254_740_992 } }),
      "Request body contains an unsafe integer",
    ],
    [
      () => sdk.lists.createRaw({ listJson: { label: "\uD800" } }),
      "Request body property \"label\" contains invalid Unicode",
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
  ]) {
    try {
      await invoke();
      throw new Error("Invalid SDK call unexpectedly succeeded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(expected)) throw error;
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
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}
