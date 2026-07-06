#!/usr/bin/env node
import readline from "node:readline";
import { createMCPServer } from "toolcraft/mcp";
import type { JSONRPCMessage, SDKTransport } from "tiny-stdio-mcp-server";
import { root } from "./root.js";
import { loadDotEnv } from "./env.js";
import { terminalSafeText } from "./skylight/text.js";
import { packageVersion } from "./version.js";

loadDotEnv();

const server = createMCPServer(root, {
  name: "skylight-calendar-agent",
  version: packageVersion,
});

let lines: readline.Interface | undefined;
const transport: SDKTransport = {
  async start() {
    lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    lines.on("line", (line) => {
      try {
        void Promise.resolve(transport.onmessage?.(JSON.parse(line) as JSONRPCMessage)).catch(
          (error) =>
            transport.onerror?.(error instanceof Error ? error : new Error("MCP input failed."))
        );
      } catch (error) {
        transport.onerror?.(error instanceof Error ? error : new Error("Invalid MCP input."));
        void transport.send({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        });
      }
    });
    lines.on("close", () => transport.onclose?.());
  },
  async close() {
    lines?.close();
  },
  async send(message) {
    const safeMessage =
      "error" in message
        ? {
            ...message,
            error: JSON.parse(
              JSON.stringify(message.error, (_key, value) =>
                typeof value === "string" ? terminalSafeText(value) : value
              )
            ) as unknown,
          }
        : message;
    const safe = JSON.stringify(safeMessage);
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(`${safe}\n`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  },
};

await server.connect(transport);
