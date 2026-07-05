#!/usr/bin/env node
import { runMCP } from "toolcraft/mcp";
import { root } from "./root.js";
import { loadDotEnv } from "./env.js";

loadDotEnv();

await runMCP(root, {
  name: "skylight-calendar-agent",
  version: "0.1.0",
});
