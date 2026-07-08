import { createSDK } from "toolcraft/sdk";
import { root } from "../dist/root.js";

const savedEnv = { ...process.env };

function assertBoundedSchema(schema, path) {
  if (schema.kind === "optional") return assertBoundedSchema(schema.inner, path);
  if (schema.kind === "string" && schema.maxLength === undefined) {
    throw new Error(`${path} is missing a string length limit`);
  }
  if (schema.kind === "array") {
    if (schema.maxItems === undefined) {
      throw new Error(`${path} is missing an array item limit`);
    }
    assertBoundedSchema(schema.item, `${path}[]`);
  }
}

for (const group of root.children) {
  for (const command of group.children) {
    for (const [name, schema] of Object.entries(command.params.shape)) {
      assertBoundedSchema(schema, `${group.name}.${command.name}.${name}`);
    }
  }
}

const updateEmailPassword = root.children
  .find((group) => group.name === "profiles")
  ?.children.find((command) => command.name === "update-email")
  ?.params.shape.password?.inner;
if (
  updateEmailPassword?.kind !== "string" ||
  updateEmailPassword.secret !== true ||
  updateEmailPassword.maxLength !== 8_192
) {
  throw new Error("profiles.update-email.password must be bounded and marked secret");
}

const frameShareToken = root.children
  .find((group) => group.name === "profiles")
  ?.children.find((command) => command.name === "frame-share-token-redeem")
  ?.params.shape.shareToken;
if (frameShareToken?.kind !== "string" || frameShareToken.secret !== true) {
  throw new Error("profiles.frame-share-token-redeem.shareToken must be marked secret");
}

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
      if (new URL(String(url)).pathname === "/api/frames/calendar") {
        return Response.json({ data: [{ id: "42", attributes: { apps: ["calendar"] } }] });
      }
      return Response.json({ ok: true, data: [] });
    },
  });
  let commandCount = 0;

  for (const group of root.children) {
    for (const command of group.children) {
      const scope = command.scope ?? group.scope ?? ["cli", "sdk"];
      if (!scope.includes("sdk")) continue;
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
      const operationRequests = group.name === "profiles" && command.name === "frames"
        ? commandRequests
        : commandRequests.filter(
          (request) => new URL(request.url).pathname !== "/api/frames/calendar"
        );
      if (operationRequests.length !== expectedRequests) {
        throw new Error(
          `${group.name}.${command.name} made ${operationRequests.length} operation requests; expected ${expectedRequests}`
        );
      }
      for (const request of commandRequests) {
        const url = new URL(request.url);
        const method = request.init?.method;
        const headers = new Headers(request.init?.headers);
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
        if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
          throw new Error(`${group.name}.${command.name} used an invalid HTTP method: ${method}`);
        }
        if (method === "GET" && request.init?.body !== undefined) {
          throw new Error(`${group.name}.${command.name} sent a body with GET`);
        }
        if (headers.get("accept") !== "application/json") {
          throw new Error(`${group.name}.${command.name} omitted the JSON accept header`);
        }
        if (headers.get("skylight-api-version") !== "2026-05-01") {
          throw new Error(`${group.name}.${command.name} omitted the API version header`);
        }
        const publicRequest = group.name === "profiles" && command.name === "forgot-password";
        if ((headers.has("authorization")) === publicRequest) {
          throw new Error(`${group.name}.${command.name} used the wrong authentication mode`);
        }
        if (request.init?.body !== undefined) {
          if (headers.get("content-type") !== "application/json") {
            throw new Error(`${group.name}.${command.name} omitted the JSON content type`);
          }
          JSON.parse(String(request.init.body));
        }
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
