import { getAuthorizationHeader } from "../dist/skylight/auth.js";

const credentials = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_EMAIL: "person@example.com",
  SKYLIGHT_PASSWORD: "secret",
};

for (const [name, value] of [
  ["SKYLIGHT_AUTH_HEADER", "Bearer good\nInjected: x"],
  ["SKYLIGHT_BASIC_TOKEN", "good\rbad"],
  ["SKYLIGHT_BEARER_TOKEN", "good\u0000bad"],
]) {
  try {
    await getAuthorizationHeader({ fetch: globalThis.fetch, env: { [name]: value } });
    throw new Error(`${name} with control characters unexpectedly succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(`${name} must not contain control characters`)) throw error;
  }
}

try {
  await getAuthorizationHeader({
    fetch: globalThis.fetch,
    env: { SKYLIGHT_EMAIL: "not-an-email", SKYLIGHT_PASSWORD: "secret" },
  });
  throw new Error("Invalid login email unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_EMAIL must be a valid email address")) throw error;
}

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
      throw new Error("\u001b[31msocket closed\u001b[0m\rreplace");
    },
    env: credentials,
  });
  throw new Error("Network login error unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message.includes("Login request failed") ||
    !message.includes("socket closed") ||
    message.includes("\u001b") ||
    message.includes("\r")
  ) {
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

try {
  await getAuthorizationHeader({
    fetch: async () => Response.json({ data: { id: 123, attributes: { token: {} } } }),
    env: credentials,
  });
  throw new Error("Malformed login credentials unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("missing valid string id/token values")) throw error;
}

try {
  await getAuthorizationHeader({
    fetch: async () => new Response("\u001b[31mbad\u001b[0m\rreplace", { status: 401 }),
    env: { ...credentials, SKYLIGHT_BASIC_TOKEN: undefined },
  });
  throw new Error("Control-character login error unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("\u001b") || message.includes("\r")) {
    throw new Error(`Login error retained terminal control characters: ${JSON.stringify(message)}`);
  }
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

let submittedPassword;
await getAuthorizationHeader({
  fetch: async (_url, init) => {
    submittedPassword = JSON.parse(String(init?.body)).password;
    return Response.json({ data: { id: "789", attributes: { token: "ghi" } } });
  },
  env: {
    SKYLIGHT_API_BASE: "https://example.invalid",
    SKYLIGHT_EMAIL: "person@example.com",
    SKYLIGHT_PASSWORD: " secret ",
  },
});
if (submittedPassword !== " secret ") {
  throw new Error(`Password whitespace was altered: ${JSON.stringify(submittedPassword)}`);
}

const concurrentEnv = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_EMAIL: "concurrent@example.com",
  SKYLIGHT_PASSWORD: "secret",
};
let concurrentCalls = 0;
let releaseLogin;
const loginGate = new Promise((resolve) => {
  releaseLogin = resolve;
});
const concurrentFetch = async () => {
  concurrentCalls += 1;
  await loginGate;
  return Response.json({ data: { id: "999", attributes: { token: "xyz" } } });
};
const firstLogin = getAuthorizationHeader({ fetch: concurrentFetch, env: concurrentEnv });
const secondLogin = getAuthorizationHeader({ fetch: concurrentFetch, env: concurrentEnv });
await new Promise((resolve) => setTimeout(resolve, 0));
if (concurrentCalls !== 1) {
  throw new Error(`Concurrent login was not deduplicated: ${concurrentCalls} calls`);
}
releaseLogin();
await Promise.all([firstLogin, secondLogin]);
