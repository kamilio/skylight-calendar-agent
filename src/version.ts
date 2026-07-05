import fs from "node:fs";

const metadata = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version?: unknown };

if (typeof metadata.version !== "string" || metadata.version.length === 0) {
  throw new Error("package.json is missing a valid version.");
}

export const packageVersion = metadata.version;
