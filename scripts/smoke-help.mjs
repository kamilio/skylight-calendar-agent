import { spawnSync } from "node:child_process";
import { root } from "../dist/root.js";

const rootHelp = spawnSync(process.execPath, ["dist/cli.js", "--help"], {
  encoding: "utf8",
});
const rootOutput = `${rootHelp.stdout ?? ""}${rootHelp.stderr ?? ""}`;
if (
  rootHelp.status !== 0 ||
  !rootOutput.includes("skylight — Skylight Calendar Agent") ||
  rootOutput.includes("(scoped)")
) {
  throw new Error(`Root help title is incorrect: ${rootOutput}`);
}

function collectPaths(group, prefix = []) {
  const paths = [];
  for (const child of group.children ?? []) {
    const path = [...prefix, child.name];
    paths.push(path);
    if (child.kind === "group") paths.push(...collectPaths(child, path));
  }
  return paths;
}

for (const path of collectPaths(root)) {
  const result = spawnSync(process.execPath, ["dist/cli.js", ...path, "--help"], {
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 || !output.includes("Usage:")) {
    throw new Error(`Help failed for ${path.join(" ")}: ${output}`);
  }
}
