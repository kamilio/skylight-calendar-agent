#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { root } from "./root.js";
import { loadDotEnv } from "./env.js";
import { packageVersion } from "./version.js";

loadDotEnv();

await runCLI(root, {
  rootUsageName: "skylight",
  version: packageVersion,
});
