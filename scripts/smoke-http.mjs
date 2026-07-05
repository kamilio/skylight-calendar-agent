import { requestJson } from "../dist/skylight/http.js";

const env = {
  SKYLIGHT_API_BASE: "https://example.invalid",
  SKYLIGHT_AUTH_HEADER: "Bearer test",
};

try {
  await requestJson({
    fetch: async () => {
      throw new Error("socket closed");
    },
    env,
    method: "GET",
    path: "/api/frames/42/lists",
  });
  throw new Error("Network error unexpectedly succeeded");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("GET /api/frames/42/lists") || !message.includes("socket closed")) {
    throw new Error(`Network error lacks request context: ${message}`);
  }
}

try {
  await requestJson({
    fetch: async () => new Response("x".repeat(100_000), { status: 500 }),
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
