#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { root } from "./root.js";
import { loadDotEnv } from "./env.js";

loadDotEnv();

await runCLI(root, {
  rootUsageName: "skylight",
  version: "0.1.0",
});
