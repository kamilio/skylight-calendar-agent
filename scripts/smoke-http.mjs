import { requestJson } from "../dist/skylight/http.js";
import { assertWellFormedUnicode } from "../dist/skylight/validation.js";

const env = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_AUTH_HEADER: "Bearer test",
};

const refreshEnv = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_EMAIL: "refresh@example.com",
  SKYLIGHT_PASSWORD: "secret",
};
let sessionCalls = 0;
let resourceCalls = 0;
let acceptedToken = "old";
const refreshFetch = async (url, init) => {
  if (new URL(url).pathname === "/api/sessions") {
    sessionCalls += 1;
    const token = sessionCalls === 1 ? "old" : "new";
    return Response.json({ data: { id: "user", attributes: { token } } });
  }
  resourceCalls += 1;
  const expected = `Basic ${Buffer.from(`user:${acceptedToken}`).toString("base64")}`;
  return init?.headers?.authorization === expected
    ? Response.json({ ok: true })
    : new Response("expired", { status: 401 });
};
await requestJson({ fetch: refreshFetch, env: refreshEnv, method: "GET", path: "/api/test" });
acceptedToken = "new";
await requestJson({ fetch: refreshFetch, env: refreshEnv, method: "GET", path: "/api/test" });
if (sessionCalls !== 2 || resourceCalls !== 3) {
  throw new Error(`Expired session was not refreshed once: ${sessionCalls} logins, ${resourceCalls} requests`);
}

try {
  await requestJson({
    fetch: async (_url, init) =>
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    env: { ...env, SKYLIGHT_REQUEST_TIMEOUT_MS: "10" },
    method: "GET",
    path: "/api/frames/42/lists",
  });
  throw new Error("Timed-out request unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("timed out after 10ms") || !message.includes("GET /api/frames/42/lists")) {
    throw error;
  }
}

const sanitizedSuccess = await requestJson({
  fetch: async () =>
    new Response(
      JSON.stringify({
        "bad\u001bkey": "\u001b[31mred\u001b[0m\rreplace\nkeep-newline",
        nested: ["ok\u009bunsafe"],
        ["__proto__"]: "safe",
      }),
      { status: 200 }
    ),
  env,
  method: "GET",
  path: "/api/test",
});
const sanitizedText = JSON.stringify(sanitizedSuccess);
if (
  sanitizedText.includes("\u001b") ||
  sanitizedText.includes("\u009b") ||
  sanitizedText.includes("\\r") ||
  sanitizedSuccess["bad key"] !== "red replace\nkeep-newline" ||
  !Object.prototype.hasOwnProperty.call(sanitizedSuccess, "__proto__")
) {
  throw new Error(`Successful response retained terminal controls: ${sanitizedText}`);
}

let deeplyNested = "0";
for (let depth = 0; depth < 101; depth += 1) deeplyNested = `[${deeplyNested}]`;
try {
  await requestJson({
    fetch: async () => new Response(deeplyNested, { status: 200 }),
    env,
    method: "GET",
    path: "/api/test",
  });
  throw new Error("Excessively nested response unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("maximum nesting depth of 100")) throw error;
}

try {
  await requestJson({
    fetch: async () =>
      new Response(JSON.stringify({ ["same\u001b"]: 1, "same ": 2 }), { status: 200 }),
    env,
    method: "GET",
    path: "/api/test",
  });
  throw new Error("Sanitized duplicate response keys unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("duplicate keys after terminal sanitization")) throw error;
}

try {
  await requestJson({
    fetch: async () => new Response("unauthorized", { status: 401 }),
    env,
    method: "GET",
    path: "/api/test",
  });
  throw new Error("Unauthorized request unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message.includes("check the configured Skylight credentials or token") ||
    !message.includes("take precedence over email/password login")
  ) {
    throw new Error(`Unauthorized error lacked credential guidance: ${message}`);
  }
}

try {
  await requestJson({
    fetch: async () =>
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "\u001b[31m120\u001b[0m" },
      }),
    env,
    method: "GET",
    path: "/api/test",
  });
  throw new Error("Rate-limited request unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Retry after 120.") || message.includes("\u001b")) {
    throw new Error(`Rate-limit error lacked safe retry guidance: ${JSON.stringify(message)}`);
  }
}

try {
  await requestJson({
    fetch: async () => new Response("\u001b[31mred\u001b[0m\rreplace", { status: 500 }),
    env,
    method: "GET",
    path: "/api/test",
  });
  throw new Error("Control-character error response unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("\u001b") || message.includes("\r")) {
    throw new Error(`Error response retained terminal control characters: ${JSON.stringify(message)}`);
  }
}

try {
  await requestJson({
    fetch: async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
          },
        }),
        { status: 200 }
      ),
    env: { ...env, SKYLIGHT_REQUEST_TIMEOUT_MS: "10" },
    method: "GET",
    path: "/api/frames/42/lists",
  });
  throw new Error("Timed-out response body unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("timed out after 10ms")) throw error;
}

try {
  await requestJson({
    fetch: async () => {
      throw new Error("\u001b[31msocket closed\u001b[0m\rreplace");
    },
    env,
    method: "GET",
    path: "/api/frames/42/lists",
  });
  throw new Error("Network error unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message.includes("GET /api/frames/42/lists") ||
    !message.includes("socket closed") ||
    message.includes("[31m") ||
    message.includes("\u001b") ||
    message.includes("\r")
  ) {
    throw new Error(`Network error lacks request context: ${message}`);
  }
}

try {
  await requestJson({
    fetch: async () =>
      new Response(`${"x".repeat(1_999)}😀${"y".repeat(100_000)}`, { status: 500 }),
    env,
    method: "GET",
    path: "/api/frames/42/lists",
  });
  throw new Error("Oversized error response unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.length > 2_200 || !message.includes("truncated")) {
    throw new Error(`Oversized error response was not truncated: ${message.length}`);
  }
  assertWellFormedUnicode(message, "Truncated error message");
}

const emptyResponse = await requestJson({
  fetch: async () => new Response(null, { status: 204 }),
  env,
  method: "DELETE",
  path: "/api/frames/42/lists/7",
});
if (emptyResponse !== null) {
  throw new Error("Empty successful response should return null");
}

let arrayQueryUrl;
await requestJson({
  fetch: async (url) => {
    arrayQueryUrl = String(url);
    return Response.json({ ok: true });
  },
  env,
  method: "GET",
  path: "/api/test",
  query: { "message_ids[]": ["1", "2"] },
});
if (
  arrayQueryUrl === undefined ||
  new URL(arrayQueryUrl).searchParams.getAll("message_ids[]").join(",") !== "1,2"
) {
  throw new Error(`Array query values were not repeated: ${arrayQueryUrl}`);
}

let malformedQueryCalls = 0;
try {
  await requestJson({
    fetch: async () => {
      malformedQueryCalls += 1;
      return Response.json({ ok: true });
    },
    env,
    method: "GET",
    path: "/api/test",
    query: { search: "\uD800" },
  });
  throw new Error("Malformed Unicode query unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('Query parameter "search" contains invalid Unicode')) throw error;
}
if (malformedQueryCalls !== 0) {
  throw new Error(`Malformed Unicode query reached fetch ${malformedQueryCalls} times`);
}

try {
  await requestJson({
    fetch: async () => Response.json({ ok: true }),
    env,
    method: "POST",
    path: "/api/test",
    body: { value: 1n },
  });
  throw new Error("Unserializable request body unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("not JSON-serializable") || !message.includes("POST /api/test")) {
    throw error;
  }
}

try {
  await requestJson({
    fetch: async () => new Response("not json", { status: 200 }),
    env,
    method: "GET",
    path: "/api/frames/42/lists",
  });
  throw new Error("Invalid JSON response unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Invalid JSON response") || !message.includes("GET /api/frames/42/lists")) {
    throw error;
  }
}
