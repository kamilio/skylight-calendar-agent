import { spawn } from "node:child_process";
import fs from "node:fs";

const packageVersion = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const child = spawn(process.execPath, ["dist/mcp.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const timeout = setTimeout(() => {
  child.kill();
  throw new Error("MCP smoke test timed out");
}, 5_000);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  while (buffer.includes("\n")) {
    const newlineIndex = buffer.indexOf("\n");
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);
    if (!line) continue;

    const message = JSON.parse(line);
    if (message.id === 1) {
      if (message.result?.serverInfo?.version !== packageVersion) {
        throw new Error(
          `MCP version ${message.result?.serverInfo?.version} does not match package ${packageVersion}`
        );
      }
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        })}\n`
      );
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`
      );
      continue;
    }
    if (message.id !== 2) continue;

    const tools = message.result.tools;
    const names = tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length) {
      throw new Error("MCP tool names must be unique");
    }
    for (const tool of tools) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)) {
        throw new Error(`Invalid MCP tool name: ${tool.name}`);
      }
      if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
        throw new Error(`MCP tool lacks a description: ${tool.name}`);
      }
      if (tool.inputSchema?.type !== "object") {
        throw new Error(`MCP tool lacks an object input schema: ${tool.name}`);
      }
      if (typeof tool.title !== "string" || tool.title.trim().length === 0) {
        throw new Error(`MCP tool lacks a title: ${tool.name}`);
      }
      if (tool.outputSchema?.type !== "object") {
        throw new Error(`MCP tool lacks an object output schema: ${tool.name}`);
      }
      for (const hint of [
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
      ]) {
        if (typeof tool.annotations?.[hint] !== "boolean") {
          throw new Error(`MCP tool lacks ${hint}: ${tool.name}`);
        }
      }
    }
    const annotationCounts = tools.reduce(
      (counts, tool) => {
        if (tool.annotations.readOnlyHint) counts.read += 1;
        else if (tool.annotations.destructiveHint) counts.destructive += 1;
        else counts.additive += 1;
        if (tool.annotations.idempotentHint) counts.idempotent += 1;
        if (tool.annotations.openWorldHint) counts.openWorld += 1;
        return counts;
      },
      { read: 0, additive: 0, destructive: 0, idempotent: 0, openWorld: 0 }
    );
    if (
      JSON.stringify(annotationCounts) !==
      JSON.stringify({
        read: 40,
        additive: 23,
        destructive: 51,
        idempotent: 87,
        openWorld: 3,
      })
    ) {
      throw new Error(`Unexpected MCP annotation counts: ${JSON.stringify(annotationCounts)}`);
    }

    const expectedAnnotations = {
      skylight__lists__list: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      skylight__lists__create: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      skylight__lists__delete: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      skylight__calendar__event_create: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      skylight__calendar__event_edit: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      skylight__calendar__event_delete: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      skylight__calendar__webcal_sync: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      skylight__rewards__unredeem: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    };
    for (const [name, expected] of Object.entries(expectedAnnotations)) {
      const actual = tools.find((tool) => tool.name === name)?.annotations;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `Unexpected annotations for ${name}: ${JSON.stringify(actual)}`
        );
      }
    }

    const requiredTools = [
      "skylight__lists__create",
      "skylight__lists__item_create",
      "skylight__lists__items_create",
      "skylight__tasks__chore_create_simple",
    ];
    for (const name of requiredTools) {
      if (!names.includes(name)) {
        throw new Error(`MCP tool missing: ${name}`);
      }
    }

    const forbiddenTools = [
      "skylight__auth__login",
      "skylight__auth__status",
      "skylight__auth__logout",
      "skylight__profiles__token",
      "skylight__profiles__forgot_password",
      "skylight__profiles__update_email",
      "skylight__profiles__user_delete",
      "skylight__profiles__frame_transfer",
      "skylight__profiles__frame_share_token_redeem",
      "skylight__profiles__plus_resend_entitlement_email",
      "skylight__profiles__user_export",
      "skylight__profiles__discount_code",
      "skylight__profiles__frame_hide",
      "skylight__profiles__device_delete",
      "skylight__profiles__device_reset",
      "skylight__profiles__device_activation_code",
      "skylight__calendar__sync_oauth_url",
      "skylight__meals__migrate",
      "skylight__photos__upload_credentials",
      "skylight__photos__upload_url",
      "skylight__photos__upload_urls",
      "skylight__photos__upload_message",
      "skylight__meals__create_raw",
    ];
    for (const name of forbiddenTools) {
      if (names.includes(name)) throw new Error(`MCP exposes sensitive tool: ${name}`);
    }

    const forbiddenSchemaKeywords = new Set([
      "format",
      "maxItems",
      "maximum",
      "maxLength",
      "minItems",
      "minimum",
      "minLength",
      "pattern",
    ]);
    function assertTypeOnlySchema(value, path) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => assertTypeOnlySchema(item, `${path}[${index}]`));
        return;
      }
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (forbiddenSchemaKeywords.has(key)) {
          throw new Error(`${path} exposes custom MCP validation keyword ${key}`);
        }
        assertTypeOnlySchema(child, `${path}.${key}`);
      }
    }
    for (const tool of tools) assertTypeOnlySchema(tool.inputSchema, tool.name);

    const page = tools.find((tool) => tool.name === "skylight__photos__list")
      ?.inputSchema?.properties?.page;
    if (page?.type !== "integer") {
      throw new Error("Photo page must retain its declared integer type");
    }

    const chores = tools.find((tool) => tool.name === "skylight__tasks__chores");
    if (
      chores?.inputSchema?.required?.includes("include_late") ||
      chores?.inputSchema?.required?.includes("include_up_for_grabs") ||
      chores?.inputSchema?.properties?.include_late?.default !== true ||
      chores?.inputSchema?.properties?.include_up_for_grabs?.default !== false
    ) {
      throw new Error("Chore filter defaults must remain optional in MCP");
    }

    const mealInstance = tools.find((tool) => tool.name === "skylight__meals__delete")
      ?.inputSchema?.properties?.instance_iso;
    if (mealInstance?.type !== "string") {
      throw new Error("Meal instance MCP parameter must remain instance_iso");
    }

    clearTimeout(timeout);
    child.kill();
  }
});

child.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0.0" },
    },
  })}\n`
);

await new Promise((resolve, reject) => {
  child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    if (signal === "SIGTERM" || code === 0) resolve();
    else reject(new Error(`MCP server exited with code ${code}`));
  });
  child.on("error", reject);
});
