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

const browserLogin = spawnSync(process.execPath, ["dist/cli.js", "auth", "login"], {
  encoding: "utf8",
});
const browserLoginOutput = `${browserLogin.stdout ?? ""}${browserLogin.stderr ?? ""}`;
const browserLoginUrl = browserLoginOutput.split(/\r?\n/, 1)[0] ?? "";
if (
  browserLogin.status !== 0 ||
  !browserLoginUrl.startsWith("https://app.ourskylight.com/oauth/authorize?") ||
  !browserLoginUrl.includes("state=") ||
  browserLoginUrl.includes("…")
) {
  throw new Error(`Browser login did not print the complete OAuth URL: ${browserLoginOutput}`);
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

const oauthHelp = spawnSync(
  process.execPath,
  ["dist/cli.js", "calendar", "sync-oauth-url", "--help"],
  { encoding: "utf8" }
);
const oauthOutput = `${oauthHelp.stdout ?? ""}${oauthHelp.stderr ?? ""}`;
if (
  !oauthOutput.includes("--no-two-way-sync") ||
  !oauthOutput.includes("Whether two-way sync is enabled") ||
  oauthOutput.includes("--no-two-way-sync               Enable two-way sync")
) {
  throw new Error(`OAuth boolean help is misleading: ${oauthOutput}`);
}

const choresHelp = spawnSync(process.execPath, ["dist/cli.js", "tasks", "chores", "--help"], {
  encoding: "utf8",
});
const choresOutput = `${choresHelp.stdout ?? ""}${choresHelp.stderr ?? ""}`;
if (
  !choresOutput.includes("--no-include-late") ||
  !choresOutput.includes("Whether to include late chores") ||
  choresOutput.includes("--no-include-late        Include late chores")
) {
  throw new Error(`Chores boolean help is misleading: ${choresOutput}`);
}

const eventCreateHelp = spawnSync(
  process.execPath,
  ["dist/cli.js", "calendar", "event-create", "--help"],
  { encoding: "utf8" }
);
const eventCreateOutput = `${eventCreateHelp.stdout ?? ""}${eventCreateHelp.stderr ?? ""}`;
if (eventCreateOutput.includes("--recurring")) {
  throw new Error(`Event creation advertises a no-op recurring flag: ${eventCreateOutput}`);
}

const tokenHelp = spawnSync(
  process.execPath,
  ["dist/cli.js", "profiles", "token", "--help"],
  { encoding: "utf8" }
);
const tokenOutput = `${tokenHelp.stdout ?? ""}${tokenHelp.stderr ?? ""}`;
if (
  !tokenOutput.includes("configured or login-generated Authorization header") ||
  tokenOutput.includes("Log in and print")
) {
  throw new Error(`Token help incorrectly promises a login: ${tokenOutput}`);
}
