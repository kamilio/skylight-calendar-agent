import { spawn } from "node:child_process";

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
    if (message.id !== 2) continue;

    const tools = message.result.tools;
    const names = tools.map((tool) => tool.name);
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
      "skylight__profiles__token",
      "skylight__profiles__update_email",
      "skylight__profiles__user_delete",
      "skylight__profiles__frame_transfer",
      "skylight__profiles__frame_share_token_redeem",
    ];
    for (const name of forbiddenTools) {
      if (names.includes(name)) throw new Error(`MCP exposes sensitive tool: ${name}`);
    }

    const bulkCreate = tools.find((tool) => tool.name === "skylight__lists__items_create");
    if (bulkCreate?.inputSchema?.properties?.labels?.minItems !== 1) {
      throw new Error("Bulk list item creation must require at least one item");
    }

    for (const [toolName, parameterNames] of Object.entries({
      skylight__lists__items_move_section: ["item_ids"],
      skylight__lists__items_delete: ["item_ids"],
      skylight__photos__delete_many: ["message_ids"],
      skylight__photos__copy_to_frames: ["message_ids", "new_frame_ids"],
      skylight__photos__album_add: ["album_ids", "message_ids"],
      skylight__photos__album_remove: ["message_ids"],
      skylight__rewards__points_add: ["category_ids"],
    })) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      for (const parameterName of parameterNames) {
        if (tool?.inputSchema?.properties?.[parameterName]?.minItems !== 1) {
          throw new Error(`${toolName}.${parameterName} must require at least one item`);
        }
      }
    }

    for (const toolName of [
      "skylight__photos__list",
      "skylight__photos__comments",
      "skylight__photos__album_messages",
    ]) {
      const page = tools.find((tool) => tool.name === toolName)?.inputSchema?.properties?.page;
      if (page?.type !== "integer" || page.minimum !== 1) {
        throw new Error(`${toolName}.page must be a positive integer`);
      }
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

setTimeout(() => {
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
}, 50);

await new Promise((resolve, reject) => {
  child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    if (signal === "SIGTERM" || code === 0) resolve();
    else reject(new Error(`MCP server exited with code ${code}`));
  });
  child.on("error", reject);
});
