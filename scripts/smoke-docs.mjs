import fs from "node:fs";

const actions = fs.readFileSync("docs/actions.md", "utf8");
const config = fs.readFileSync("docs/config.md", "utf8");
const captureDocs = fs.readFileSync("docs/capturing-api-traffic.md", "utf8");
const readme = fs.readFileSync("README.md", "utf8");
const sectionFiles = fs
  .readdirSync("src/sections")
  .filter((file) => file.endsWith(".ts"));

for (const file of sectionFiles) {
  const group = file.slice(0, -".ts".length);
  const source = fs.readFileSync(`src/sections/${file}`, "utf8");
  const names = [...source.matchAll(/name: "([^"]+)"/g)]
    .map((match) => match[1])
    .slice(1);

  for (const name of names) {
    if (!actions.includes(`\`${group} ${name}\``)) {
      throw new Error(`docs/actions.md is missing ${group} ${name}`);
    }
  }
}

if (
  !config.includes("without the `Basic` scheme prefix") ||
  !config.includes("without the `Bearer` scheme prefix") ||
  !config.includes("SDK reads `process.env` but does not load `.env` automatically") ||
  !config.includes("`SKYLIGHT_API_BASE` is not loaded from `.env`") ||
  config.includes("`Authorization: Basic <base64(id:token)>` value") ||
  config.includes("`Authorization: Bearer <token>` value")
) {
  throw new Error("docs/config.md must describe token-only credential variables accurately");
}

if (!readme.includes("It does not load `.env` automatically")) {
  throw new Error("README.md must distinguish SDK process.env usage from CLI dotenv loading");
}

if (
  !readme.includes("npm run --silent dev:mcp") ||
  fs.readFileSync("docs/commands.md", "utf8").includes("MCP (stdio): `npm run dev:mcp`")
) {
  throw new Error("MCP development docs must suppress npm banners on stdout");
}

if (captureDocs.includes("Your current `skylight.har` only contains static asset")) {
  throw new Error("HAR capture guidance incorrectly describes the current capture as asset-only");
}
