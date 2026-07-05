#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { root } from "./root.js";
import { loadDotEnv } from "./env.js";
import { terminalSafeText } from "./skylight/text.js";
import { packageVersion } from "./version.js";

loadDotEnv();

if (process.argv.slice(2).some((argument) => terminalSafeText(argument, true) !== argument)) {
  process.stderr.write("Command arguments must not contain terminal control characters.\n");
  process.exitCode = 1;
} else {
  await runCLI(root, {
    rootUsageName: "skylight",
    version: packageVersion,
  });
}
