#!/usr/bin/env node
import { runMCP } from "toolcraft/mcp";
import { root } from "./root.js";
import { loadDotEnv } from "./env.js";
import { packageVersion } from "./version.js";

loadDotEnv();

await runMCP(root, {
  name: "skylight-calendar-agent",
  version: packageVersion,
});
