import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadDotEnv } from "../dist/env.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skylight-env-"));
fs.writeFileSync(
  path.join(directory, ".env"),
  'export SKYLIGHT_AUTH_HEADER="Bearer from-dotenv" # supported comment\n'
);

let authorization;
const server = http.createServer((request, response) => {
  authorization = request.headers.authorization;
  response.setHeader("content-type", "application/json");
  response.end('{"ok":true}');
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock server did not start");

const env = {
  ...process.env,
  SKYLIGHT_API_BASE: `http://127.0.0.1:${address.port}`,
  SKYLIGHT_FRAME_ID: "42",
};
for (const name of [
  "SKYLIGHT_AUTH_HEADER",
  "SKYLIGHT_BASIC_TOKEN",
  "SKYLIGHT_BEARER_TOKEN",
  "SKYLIGHT_EMAIL",
  "SKYLIGHT_PASSWORD",
]) {
  delete env[name];
}

try {
  const child = spawn(
    process.execPath,
    [path.resolve("dist/cli.js"), "lists", "list"],
    { cwd: directory, env, stdio: ["ignore", "ignore", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  if (code !== 0) throw new Error(`CLI failed (${code}): ${stderr}`);
  if (authorization !== "Bearer from-dotenv") {
    throw new Error(`Exported dotenv value was not loaded: ${authorization}`);
  }

  const escapedPath = path.join(directory, "escaped.env");
  fs.writeFileSync(escapedPath, 'SKYLIGHT_PASSWORD="a\\"b"\n');
  delete process.env.SKYLIGHT_PASSWORD;
  loadDotEnv(escapedPath);
  if (process.env.SKYLIGHT_PASSWORD !== 'a"b') {
    throw new Error(
      `Escaped quoted dotenv value was parsed incorrectly: ${JSON.stringify(process.env.SKYLIGHT_PASSWORD)}`
    );
  }
  delete process.env.SKYLIGHT_PASSWORD;

  const malformedPath = path.join(directory, "malformed.env");
  fs.writeFileSync(malformedPath, 'SKYLIGHT_PASSWORD="secret"junk\n');
  loadDotEnv(malformedPath);
  if (process.env.SKYLIGHT_PASSWORD !== undefined) {
    throw new Error("Malformed quoted dotenv value was silently truncated");
  }

  const directoryPath = path.join(directory, "directory.env");
  fs.mkdirSync(directoryPath);
  loadDotEnv(directoryPath);
} finally {
  server.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
