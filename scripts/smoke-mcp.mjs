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

    const names = message.result.tools.map((tool) => tool.name);
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
