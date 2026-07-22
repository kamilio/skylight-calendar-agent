import { chmodSync, chownSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

if (process.getuid?.() === 0) {
  const nodeAccount = statSync("/home/node");
  const databasePath = process.env.SKYLIGHT_OAUTH_DB_PATH?.trim();
  const dataDirectory = "/data";
  if (
    databasePath &&
    !path.relative(dataDirectory, path.resolve(databasePath)).startsWith("..")
  ) {
    mkdirSync(dataDirectory, { recursive: true });
    chownSync(dataDirectory, nodeAccount.uid, nodeAccount.gid);
    chmodSync(dataDirectory, 0o700);
  }
  process.setgid?.(nodeAccount.gid);
  process.setuid?.(nodeAccount.uid);
}

await import("./dist/http-mcp.js");
