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

  const bomPath = path.join(directory, "bom.env");
  fs.writeFileSync(bomPath, "\uFEFFSKYLIGHT_BEARER_TOKEN=bom-token\r\n");
  delete process.env.SKYLIGHT_BEARER_TOKEN;
  loadDotEnv(bomPath);
  if (process.env.SKYLIGHT_BEARER_TOKEN !== "bom-token") {
    throw new Error("Dotenv ignored the first variable after a UTF-8 BOM");
  }
  delete process.env.SKYLIGHT_BEARER_TOKEN;

  const malformedPath = path.join(directory, "malformed.env");
  fs.writeFileSync(malformedPath, 'SKYLIGHT_PASSWORD="secret"junk\n');
  loadDotEnv(malformedPath);
  if (process.env.SKYLIGHT_PASSWORD !== undefined) {
    throw new Error("Malformed quoted dotenv value was silently truncated");
  }

  const directoryPath = path.join(directory, "directory.env");
  fs.mkdirSync(directoryPath);
  loadDotEnv(directoryPath);

  const isolatedPath = path.join(directory, "isolated.env");
  fs.writeFileSync(
    isolatedPath,
    [
      "SKYLIGHT_AUTH_HEADER=Bearer stale",
      "SKYLIGHT_API_BASE=https://attacker.invalid",
      "SKYLIGHT_FRAME_ID=77",
    ].join("\n")
  );
  for (const name of [
    "SKYLIGHT_AUTH_HEADER",
    "SKYLIGHT_BASIC_TOKEN",
    "SKYLIGHT_BEARER_TOKEN",
    "SKYLIGHT_EMAIL",
    "SKYLIGHT_PASSWORD",
    "SKYLIGHT_API_BASE",
    "SKYLIGHT_FRAME_ID",
  ]) {
    delete process.env[name];
  }
  process.env.SKYLIGHT_BEARER_TOKEN = "fresh";
  loadDotEnv(isolatedPath);
  if (
    process.env.SKYLIGHT_AUTH_HEADER !== undefined ||
    process.env.SKYLIGHT_API_BASE !== undefined ||
    process.env.SKYLIGHT_FRAME_ID !== "77"
  ) {
    throw new Error("Dotenv credentials or API base overrode an exported credential source");
  }

  const pairedPath = path.join(directory, "paired.env");
  fs.writeFileSync(
    pairedPath,
    "SKYLIGHT_BEARER_TOKEN=stale\nSKYLIGHT_PASSWORD=paired-secret\n"
  );
  delete process.env.SKYLIGHT_BEARER_TOKEN;
  process.env.SKYLIGHT_EMAIL = "paired@example.com";
  delete process.env.SKYLIGHT_PASSWORD;
  loadDotEnv(pairedPath);
  if (
    process.env.SKYLIGHT_PASSWORD !== "paired-secret" ||
    process.env.SKYLIGHT_BEARER_TOKEN !== undefined
  ) {
    throw new Error("Dotenv did not complete the exported email/password credential pair safely");
  }

  const blankCredentialPath = path.join(directory, "blank-credential.env");
  fs.writeFileSync(blankCredentialPath, "SKYLIGHT_BEARER_TOKEN=dotenv-fallback\n");
  for (const name of [
    "SKYLIGHT_AUTH_HEADER",
    "SKYLIGHT_BASIC_TOKEN",
    "SKYLIGHT_BEARER_TOKEN",
    "SKYLIGHT_EMAIL",
    "SKYLIGHT_PASSWORD",
  ]) {
    delete process.env[name];
  }
  process.env.SKYLIGHT_AUTH_HEADER = "   ";
  loadDotEnv(blankCredentialPath);
  if (process.env.SKYLIGHT_BEARER_TOKEN !== "dotenv-fallback") {
    throw new Error("Whitespace-only exported credentials blocked a dotenv fallback");
  }

  delete process.env.SKYLIGHT_BEARER_TOKEN;
  process.env.SKYLIGHT_AUTH_HEADER = "";
  const blankSameKeyPath = path.join(directory, "blank-same-key.env");
  fs.writeFileSync(blankSameKeyPath, "SKYLIGHT_AUTH_HEADER=Bearer same-key-fallback\n");
  loadDotEnv(blankSameKeyPath);
  if (process.env.SKYLIGHT_AUTH_HEADER !== "Bearer same-key-fallback") {
    throw new Error("Blank exported credentials blocked the same dotenv credential key");
  }

  const whitespacePasswordPath = path.join(directory, "whitespace-password.env");
  fs.writeFileSync(
    whitespacePasswordPath,
    "SKYLIGHT_EMAIL=dotenv@example.com\nSKYLIGHT_BEARER_TOKEN=stale\n"
  );
  for (const name of [
    "SKYLIGHT_AUTH_HEADER",
    "SKYLIGHT_BASIC_TOKEN",
    "SKYLIGHT_BEARER_TOKEN",
    "SKYLIGHT_EMAIL",
    "SKYLIGHT_PASSWORD",
  ]) {
    delete process.env[name];
  }
  process.env.SKYLIGHT_PASSWORD = "   ";
  loadDotEnv(whitespacePasswordPath);
  if (
    process.env.SKYLIGHT_EMAIL !== "dotenv@example.com" ||
    process.env.SKYLIGHT_PASSWORD !== "   " ||
    process.env.SKYLIGHT_BEARER_TOKEN !== undefined
  ) {
    throw new Error("Dotenv did not preserve and complete a whitespace password credential pair");
  }

  const unrelatedPath = path.join(directory, "unrelated.env");
  fs.writeFileSync(unrelatedPath, "TZ=Pacific/Kiritimati\nUNRELATED=value\n");
  delete process.env.TZ;
  delete process.env.UNRELATED;
  loadDotEnv(unrelatedPath);
  if (process.env.TZ !== undefined || process.env.UNRELATED !== undefined) {
    throw new Error("Dotenv loaded unrelated process settings");
  }
} finally {
  server.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
