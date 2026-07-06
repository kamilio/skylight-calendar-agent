#!/usr/bin/env node
import { runCLI } from "toolcraft/cli";
import { root } from "./root.js";
import { loadDotEnv } from "./env.js";
import { flattenResponseLayoutForCli } from "./skylight/http.js";
import { terminalSafeText } from "./skylight/text.js";
import { packageVersion } from "./version.js";

loadDotEnv();
flattenResponseLayoutForCli();

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

type RuntimeSchema = {
  kind: string;
  inner?: RuntimeSchema;
  short?: string;
};

function invalidJsonOption(arguments_: string[]): string | null {
  const group = root.children.find((child) => child.name === arguments_[0]);
  if (group?.kind !== "group") return null;
  const command = group.children.find((child) => child.name === arguments_[1]);
  if (command?.kind !== "command") return null;

  const options = new Map<string, string>();
  for (const [name, rawSchema] of Object.entries(command.params.shape)) {
    let schema = rawSchema as RuntimeSchema;
    while (schema.kind === "optional" && schema.inner !== undefined) schema = schema.inner;
    if (schema.kind !== "json") continue;
    const longOption = `--${kebabCase(name)}`;
    options.set(longOption, longOption);
    if (schema.short !== undefined) options.set(`-${schema.short}`, longOption);
  }

  for (let index = 2; index < arguments_.length; index += 1) {
    const argument = arguments_[index] ?? "";
    for (const [option, displayOption] of options) {
      const inlinePrefix = `${option}=`;
      const value =
        argument === option
          ? arguments_[index + 1]
          : argument.startsWith(inlinePrefix)
            ? argument.slice(inlinePrefix.length)
            : option.startsWith("-") &&
                !option.startsWith("--") &&
                argument.startsWith(option) &&
                argument.length > option.length
              ? argument.slice(option.length)
            : undefined;
      if (value === undefined) continue;
      try {
        JSON.parse(value);
      } catch {
        return displayOption;
      }
    }
  }
  return null;
}

const commandArguments = process.argv.slice(2);
const unsafeArgument = commandArguments.some(
  (argument) => terminalSafeText(argument) !== argument
);
const invalidJson = unsafeArgument ? null : invalidJsonOption(commandArguments);

if (unsafeArgument) {
  process.stderr.write("Command arguments must not contain unsafe terminal formatting characters.\n");
  process.exitCode = 1;
} else if (invalidJson !== null) {
  process.stderr.write(`Invalid JSON for ${invalidJson}. The value was not displayed.\n`);
  process.exitCode = 1;
} else {
  await runCLI(root, {
    rootUsageName: "skylight",
    version: packageVersion,
  });
}
