import { createSDK } from "toolcraft/sdk";
import { root } from "../dist/root.js";

const savedEnv = { ...process.env };

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function unwrap(schema) {
  let current = schema;
  while (current.kind === "optional") current = current.inner;
  return current;
}

function minimalValue(name, schema) {
  const current = unwrap(schema);
  if (name === "confirm") return true;
  if (name === "early" || name === "onTime") return false;
  if (current.kind === "boolean") return false;
  if (current.kind === "number") return current.minimum ?? 1;
  if (current.kind === "array") return [minimalValue(name.replace(/s$/, ""), current.item)];
  if (current.kind === "json") return { value: "x" };
  if (current.kind === "enum") return current.values?.[0];
  if (current.kind === "string") {
    const lowerName = name.toLowerCase();
    if (lowerName.includes("email")) return "person@example.com";
    if (name === "birthday") return "02/29";
    if (name === "instanceIso" || lowerName.includes("date") || name === "start" || name === "startsAt") {
      return "2026-07-05";
    }
    if (lowerName.includes("time") && !lowerName.includes("timezone")) return "12:00";
    if (name === "timezone") return "UTC";
    if (lowerName.includes("url")) return "https://example.com/callback";
    if (name === "afterItemId") return "1";
    return "x";
  }
  throw new Error(`Unsupported schema kind for ${name}: ${current.kind}`);
}

const optionalArguments = {
  "calendar.calendar-account-update": { activeCalendars: ["calendar-1"] },
  "calendar.event-edit": { summary: "Updated" },
  "meals.update": { recipeId: "recipe-1" },
  "profiles.owner-profile-update": { name: "Owner" },
  "recipes.update": { summary: "Updated" },
};

try {
  Object.assign(process.env, {
    SKYLIGHT_API_BASE: "https://example.invalid",
    SKYLIGHT_AUTH_HEADER: "Bearer test",
    SKYLIGHT_FRAME_ID: "42",
    SKYLIGHT_PASSWORD: "secret",
  });

  const requests = [];
  const sdk = createSDK(root, {
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ ok: true, data: [] });
    },
  });
  let commandCount = 0;

  for (const group of root.children) {
    for (const command of group.children) {
      const argumentsForCommand = {
        ...(optionalArguments[`${group.name}.${command.name}`] ?? {}),
      };
      for (const [name, schema] of Object.entries(command.params.shape)) {
        if (schema.kind !== "optional") {
          argumentsForCommand[name] = minimalValue(name, schema);
        }
      }
      const requestCount = requests.length;
      await sdk[camelCase(group.name)][camelCase(command.name)](argumentsForCommand);
      const expectedRequests = group.name === "profiles" && command.name === "token" ? 0 : 1;
      const commandRequests = requests.slice(requestCount);
      if (commandRequests.length !== expectedRequests) {
        throw new Error(
          `${group.name}.${command.name} made ${commandRequests.length} requests; expected ${expectedRequests}`
        );
      }
      for (const request of commandRequests) {
        const url = new URL(request.url);
        if (
          url.origin !== "https://example.invalid" ||
          !url.pathname.startsWith("/api/") ||
          request.url.includes("undefined") ||
          request.url.includes("[object%20Object]")
        ) {
          throw new Error(
            `${group.name}.${command.name} produced an invalid request URL: ${request.url}`
          );
        }
        if (request.init?.body !== undefined) JSON.parse(String(request.init.body));
      }
      commandCount += 1;
    }
  }

  if (commandCount < 100) {
    throw new Error(`SDK sweep covered too few commands: ${commandCount}`);
  }
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}
