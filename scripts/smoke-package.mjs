import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skylight-package-"));

try {
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", directory],
    { maxBuffer: 10 * 1024 * 1024 }
  );
  const [{ files }] = JSON.parse(stdout);
  const names = new Set(files.map((file) => file.path));
  const metadata = JSON.parse(await fs.readFile("package.json", "utf8"));
  if (metadata.directories?.doc !== undefined && !names.has(metadata.directories.doc)) {
    throw new Error(`Published package declares missing docs directory ${metadata.directories.doc}`);
  }

  for (const required of [
    "dist/cli.js",
    "dist/mcp.js",
    "dist/sections/lists.js.map",
    "src/sections/lists.ts",
    ".env.example",
    "README.md",
    "LICENSE",
  ]) {
    if (!names.has(required)) throw new Error(`Published package is missing ${required}`);
  }

  for (const forbidden of [".env", "auth.json", "skylight.har"]) {
    if (names.has(forbidden)) throw new Error(`Published package contains private file ${forbidden}`);
  }
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
