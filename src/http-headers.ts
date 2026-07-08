#!/usr/bin/env node
import { getOrCreateStoredHttpMcpToken } from "./skylight/http-auth.js";
import { terminalSafeText } from "./skylight/text.js";

try {
  const token = await getOrCreateStoredHttpMcpToken();
  process.stdout.write(`${JSON.stringify({ Authorization: `Bearer ${token}` })}\n`);
} catch (error) {
  process.stderr.write(`${terminalSafeText(error instanceof Error ? error.message : "Could not load HTTP MCP credentials.")}\n`);
  process.exitCode = 1;
}
