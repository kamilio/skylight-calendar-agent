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
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}
