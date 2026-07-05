import fs from "node:fs";

const actions = fs.readFileSync("docs/actions.md", "utf8");
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
