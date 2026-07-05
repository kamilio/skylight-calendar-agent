import { spawn } from "node:child_process";

const env = { ...process.env, SKYLIGHT_FRAME_ID: "42" };
for (const name of [
  "SKYLIGHT_AUTH_HEADER",
  "SKYLIGHT_BASIC_TOKEN",
  "SKYLIGHT_BEARER_TOKEN",
  "SKYLIGHT_EMAIL",
  "SKYLIGHT_PASSWORD",
]) {
  delete env[name];
}

const child = spawn(
  process.execPath,
  ["dist/cli.js", "lists", "create-raw", "--list-json", "not-json"],
  { env, stdio: ["ignore", "pipe", "pipe"] }
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});

const code = await new Promise((resolve, reject) => {
  child.on("exit", resolve);
  child.on("error", reject);
});

if (code === 0) throw new Error("Invalid local input unexpectedly succeeded");
if (!output.includes('Invalid value for "listJson". Expected valid JSON')) {
  throw new Error(`Local validation error was not reported: ${output}`);
}
if (output.includes("Missing credentials")) {
  throw new Error(`Credential validation ran before local validation: ${output}`);
}
