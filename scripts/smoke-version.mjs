import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const metadata = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const { stdout } = await execFileAsync(process.execPath, ["dist/cli.js", "--version"]);

if (stdout.trim() !== metadata.version) {
  throw new Error(`CLI version ${stdout.trim()} does not match package ${metadata.version}`);
}
