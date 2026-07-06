import { spawn } from "node:child_process";
import { getAuthorizationHeader } from "../dist/skylight/auth.js";

const credentials = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_EMAIL: "person@example.com",
  SKYLIGHT_PASSWORD: "secret",
};

const tokenChild = spawn(process.execPath, ["dist/cli.js", "profiles", "token"], {
  env: {
    ...process.env,
    SKYLIGHT_AUTH_HEADER: "",
    SKYLIGHT_BASIC_TOKEN: "",
    SKYLIGHT_BEARER_TOKEN: "a".repeat(12_000),
    SKYLIGHT_EMAIL: "",
    SKYLIGHT_PASSWORD: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let tokenOutput = "";
tokenChild.stdout.on("data", (chunk) => { tokenOutput += chunk; });
tokenChild.stderr.on("data", (chunk) => { tokenOutput += chunk; });
const tokenCode = await new Promise((resolve, reject) => {
  tokenChild.on("exit", resolve);
  tokenChild.on("error", reject);
});
if (tokenCode !== 0 || tokenOutput.length > 13_000 || !tokenOutput.includes("[truncated")) {
  throw new Error(`Token CLI output was not safely bounded: ${tokenOutput.length}`);
}

for (const [name, value] of [
  ["SKYLIGHT_AUTH_HEADER", "Bearer good\nInjected: x"],
  ["SKYLIGHT_AUTH_HEADER", "Bearer good\n"],
  ["SKYLIGHT_BASIC_TOKEN", "good\rbad"],
  ["SKYLIGHT_BASIC_TOKEN", "good\r"],
  ["SKYLIGHT_BEARER_TOKEN", "good\u0000bad"],
  ["SKYLIGHT_BEARER_TOKEN", "good\t"],
]) {
  try {
    await getAuthorizationHeader({ fetch: globalThis.fetch, env: { [name]: value } });
    throw new Error(`${name} with control characters unexpectedly succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(`${name} must not contain control characters`)) throw error;
  }
}

for (const [name, value, expected] of [
  ["SKYLIGHT_BASIC_TOKEN", "Basic abc", "without the Basic prefix"],
  ["SKYLIGHT_BEARER_TOKEN", "Bearer abc", "without the Bearer prefix"],
]) {
  try {
    await getAuthorizationHeader({ fetch: globalThis.fetch, env: { [name]: value } });
    throw new Error(`${name} with a duplicated scheme unexpectedly succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected) || !message.includes("SKYLIGHT_AUTH_HEADER")) throw error;
  }
}

for (const [env, expected] of [
  [{ SKYLIGHT_AUTH_HEADER: "abc" }, "complete Basic or Bearer header"],
  [{ SKYLIGHT_AUTH_HEADER: "Basic not-base64!" }, "valid base64-encoded"],
  [{ SKYLIGHT_BASIC_TOKEN: "bm8tY29sb24=" }, "separated by a colon"],
  [{ SKYLIGHT_BASIC_TOKEN: Buffer.from(":").toString("base64") }, "non-blank user-id/token"],
  [{ SKYLIGHT_BASIC_TOKEN: Buffer.from("user:").toString("base64") }, "non-blank user-id/token"],
  [
    { SKYLIGHT_BASIC_TOKEN: Buffer.from("user:\ntoken").toString("base64") },
    "SKYLIGHT_BASIC_TOKEN token must not contain control characters",
  ],
  [
    { SKYLIGHT_BASIC_TOKEN: Buffer.from("\u0000user:token").toString("base64") },
    "SKYLIGHT_BASIC_TOKEN user id must not contain control characters",
  ],
  [{ SKYLIGHT_BEARER_TOKEN: "abc def" }, "must not contain whitespace"],
  [{ SKYLIGHT_BEARER_TOKEN: "😀" }, "valid Bearer token characters"],
  [{ SKYLIGHT_BEARER_TOKEN: "abc,def" }, "valid Bearer token characters"],
  [{ SKYLIGHT_AUTH_HEADER: "Bearer 😀" }, "valid Bearer token characters"],
  [{ SKYLIGHT_AUTH_HEADER: "Bearer abc,def" }, "valid Bearer token characters"],
  [{ SKYLIGHT_AUTH_HEADER: "Bearer\u00A0abc" }, "complete Basic or Bearer header"],
]) {
  try {
    await getAuthorizationHeader({ fetch: globalThis.fetch, env });
    throw new Error(`Malformed auth value unexpectedly succeeded: ${JSON.stringify(env)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw error;
  }
}

const normalizedHeader = await getAuthorizationHeader({
  fetch: globalThis.fetch,
  env: { SKYLIGHT_AUTH_HEADER: "bearer  abc" },
});
if (normalizedHeader !== "Bearer abc") {
  throw new Error(`Authorization header spacing was not normalized: ${normalizedHeader}`);
}

try {
  await getAuthorizationHeader({
    fetch: globalThis.fetch,
    env: { SKYLIGHT_AUTH_HEADER: "Bearer \uD800" },
  });
  throw new Error("Malformed Unicode auth header unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_AUTH_HEADER contains invalid Unicode")) throw error;
}

try {
  await getAuthorizationHeader({
    fetch: async () => {
      throw { toString: () => { throw new Error("login-coercion-secret"); } };
    },
    env: credentials,
  });
  throw new Error("Hostile login rejection unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Login request failed: Unknown error") || message.includes("secret")) {
    throw error;
  }
}

try {
  await getAuthorizationHeader({
    fetch: globalThis.fetch,
    env: { SKYLIGHT_EMAIL: `${"a".repeat(321)}@example.com`, SKYLIGHT_PASSWORD: "secret" },
  });
  throw new Error("Oversized login email unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_EMAIL must not exceed 320 characters")) throw error;
}

try {
  await getAuthorizationHeader({
    fetch: globalThis.fetch,
    env: { SKYLIGHT_BEARER_TOKEN: "a".repeat(20_000) },
  });
  throw new Error("Oversized Bearer token unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_BEARER_TOKEN must not exceed 16384 characters")) throw error;
  if (message.includes("a".repeat(1_000))) {
    throw new Error("Oversized Bearer token was exposed in its validation error");
  }
}

let oversizedPasswordCalls = 0;
try {
  await getAuthorizationHeader({
    fetch: async () => {
      oversizedPasswordCalls += 1;
      return Response.json({ data: { id: "1", attributes: { token: "x" } } });
    },
    env: { ...credentials, SKYLIGHT_PASSWORD: "p".repeat(8_193) },
  });
  throw new Error("Oversized login password unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_PASSWORD must not exceed 8192 characters")) throw error;
  if (oversizedPasswordCalls !== 0) {
    throw new Error("Oversized login password reached fetch");
  }
}

try {
  await getAuthorizationHeader({
    fetch: async () => Response.json({ data: { id: "1", attributes: { token: "x" } } }),
    env: { ...credentials, SKYLIGHT_PASSWORD: "\uD800" },
  });
  throw new Error("Malformed Unicode password unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_PASSWORD contains invalid Unicode")) throw error;
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
    fetch: globalThis.fetch,
    env: { SKYLIGHT_EMAIL: "a\u0000@b.com", SKYLIGHT_PASSWORD: "secret" },
  });
  throw new Error("Control-character login email unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_EMAIL must not contain control characters")) throw error;
}

try {
  await getAuthorizationHeader({
    fetch: globalThis.fetch,
    env: { SKYLIGHT_EMAIL: "person@example.com\n", SKYLIGHT_PASSWORD: "secret" },
  });
  throw new Error("Trailing-control login email unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("SKYLIGHT_EMAIL must not contain control characters")) throw error;
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
    message.includes("[31m") ||
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
  if (
    !message.includes("Login response was not valid JSON") ||
    !message.includes("not json")
  ) {
    throw error;
  }
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

for (const body of ["null", "[]", '"unexpected"']) {
  try {
    await getAuthorizationHeader({
      fetch: async () => new Response(body, { status: 200 }),
      env: credentials,
    });
    throw new Error(`Primitive login response unexpectedly succeeded: ${body}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("missing valid string id/token values")) throw error;
    if (message.includes("Cannot read properties")) {
      throw new Error(`Primitive login response leaked an internal TypeError: ${message}`);
    }
  }
}

try {
  await getAuthorizationHeader({
    fetch: async () =>
      Response.json({ data: { id: "user:other", attributes: { token: "secret" } } }),
    env: credentials,
  });
  throw new Error("Colon-bearing login id unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Login response id must not contain a colon")) throw error;
}

for (const response of [
  { data: { id: " user", attributes: { token: "secret" } } },
  { data: { id: "user", attributes: { token: "secret " } } },
]) {
  try {
    await getAuthorizationHeader({
      fetch: async () => Response.json(response),
      env: credentials,
    });
    throw new Error("Whitespace-bearing login credentials unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("must not have surrounding whitespace")) throw error;
  }
}

try {
  await getAuthorizationHeader({
    fetch: async () =>
      new Response('{"data":{"id":"user","attributes":{"token":"\\ud800"}}}', {
        status: 200,
      }),
    env: credentials,
  });
  throw new Error("Malformed Unicode login token unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Login response token contains invalid Unicode")) throw error;
}

for (const [field, response] of [
  ["id", { data: { id: "user\nname", attributes: { token: "token" } } }],
  ["token", { data: { id: "user", attributes: { token: "to\tken" } } }],
]) {
  try {
    await getAuthorizationHeader({
      fetch: async () => Response.json(response),
      env: credentials,
    });
    throw new Error(`Control-character login ${field} unexpectedly succeeded`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(`Login response ${field} must not contain control characters`)) {
      throw error;
    }
  }
}

try {
  await getAuthorizationHeader({
    fetch: async () => new Response("\u001b[31mbad\u001b[0m\rreplace", { status: 401 }),
    env: { ...credentials, SKYLIGHT_BASIC_TOKEN: undefined },
  });
  throw new Error("Control-character login error unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("[31m") || message.includes("\u001b") || message.includes("\r")) {
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
if (isolatedEnv.SKYLIGHT_BASIC_TOKEN !== undefined) {
  throw new Error("Generated login token leaked into the custom environment");
}
if (process.env.SKYLIGHT_BASIC_TOKEN !== undefined) {
  throw new Error("Custom env login polluted process.env");
}

isolatedEnv.SKYLIGHT_EMAIL = "changed@example.com";
isolatedEnv.SKYLIGHT_PASSWORD = "changed-secret";
await getAuthorizationHeader({ fetch: isolatedFetch, env: isolatedEnv });
if (loginCalls !== 2 || isolatedEnv.SKYLIGHT_BASIC_TOKEN !== undefined) {
  throw new Error(`Changed credentials reused a generated token; login calls: ${loginCalls}`);
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

const changingEnv = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_EMAIL: "first@example.com",
  SKYLIGHT_PASSWORD: "first-secret",
};
let releaseFirstLogin;
const firstLoginGate = new Promise((resolve) => {
  releaseFirstLogin = resolve;
});
const changingEmails = [];
const changingFetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  changingEmails.push(body.email);
  if (body.email === "first@example.com") await firstLoginGate;
  return Response.json({
    data: { id: body.email, attributes: { token: body.password } },
  });
};
const staleLogin = getAuthorizationHeader({ fetch: changingFetch, env: changingEnv });
await new Promise((resolve) => setTimeout(resolve, 0));
changingEnv.SKYLIGHT_EMAIL = "second@example.com";
changingEnv.SKYLIGHT_PASSWORD = "second-secret";
const currentLogin = getAuthorizationHeader({ fetch: changingFetch, env: changingEnv });
const currentAuthorization = await currentLogin;
releaseFirstLogin();
const staleAuthorization = await staleLogin;
if (
  changingEmails.join(",") !== "first@example.com,second@example.com" ||
  staleAuthorization === currentAuthorization ||
  changingEnv.SKYLIGHT_BASIC_TOKEN !== undefined
) {
  throw new Error(
    `Credential changes leaked across logins: ${JSON.stringify({ changingEmails, staleAuthorization, currentAuthorization })}`
  );
}
