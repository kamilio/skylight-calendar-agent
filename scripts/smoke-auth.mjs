import { getAuthorizationHeader } from "../dist/skylight/auth.js";

const credentials = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_EMAIL: "person@example.com",
  SKYLIGHT_PASSWORD: "secret",
};

try {
  await getAuthorizationHeader({
    fetch: async (_url, init) =>
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    env: { ...credentials, SKYLIGHT_REQUEST_TIMEOUT_MS: "10" },
  });
  throw new Error("Timed-out login unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Login request timed out after 10ms")) throw error;
}

try {
  await getAuthorizationHeader({
    fetch: async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
          },
        }),
        { status: 200 }
      ),
    env: { ...credentials, SKYLIGHT_REQUEST_TIMEOUT_MS: "10" },
  });
  throw new Error("Timed-out login response body unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Login request timed out after 10ms")) throw error;
}

try {
  await getAuthorizationHeader({
    fetch: async () => {
      throw new Error("socket closed");
    },
    env: credentials,
  });
  throw new Error("Network login error unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Login request failed") || !message.includes("socket closed")) {
    throw error;
  }
}

try {
  await getAuthorizationHeader({
    fetch: async () => new Response("not json", { status: 200 }),
    env: credentials,
  });
  throw new Error("Invalid login JSON unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Login response was not valid JSON")) throw error;
}

const authorization = await getAuthorizationHeader({
  fetch: async () =>
    Response.json({
      data: { id: "123", attributes: { token: "abc" } },
    }),
  env: credentials,
});
if (authorization !== `Basic ${Buffer.from("123:abc").toString("base64")}`) {
  throw new Error("Login response did not produce the expected authorization header");
}

delete process.env.SKYLIGHT_BASIC_TOKEN;
const isolatedEnv = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_EMAIL: "isolated@example.com",
  SKYLIGHT_PASSWORD: "secret",
};
let loginCalls = 0;
const isolatedFetch = async () => {
  loginCalls += 1;
  return Response.json({ data: { id: "456", attributes: { token: "def" } } });
};
await getAuthorizationHeader({ fetch: isolatedFetch, env: isolatedEnv });
await getAuthorizationHeader({ fetch: isolatedFetch, env: isolatedEnv });
if (loginCalls !== 1) throw new Error(`Custom env token was not cached; login calls: ${loginCalls}`);
if (!isolatedEnv.SKYLIGHT_BASIC_TOKEN) throw new Error("Custom env did not receive cached token");
if (process.env.SKYLIGHT_BASIC_TOKEN !== undefined) {
  throw new Error("Custom env login polluted process.env");
}
