import fs from "node:fs";
import path from "node:path";

function parseDotEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("export ")) {
      line = line.slice("export ".length).trimStart();
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    let value = line.slice(equalsIndex + 1).trim();

    if (value.startsWith('"')) {
      const closingQuote = value.indexOf('"', 1);
      if (closingQuote < 0) continue;
      value = value.slice(1, closingQuote);
    } else if (value.startsWith("'")) {
      const closingQuote = value.indexOf("'", 1);
      if (closingQuote < 0) continue;
      value = value.slice(1, closingQuote);
    } else {
      const commentIndex = value.indexOf("#");
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trimEnd();
    }

    out[key] = value;
  }

  return out;
}

export function loadDotEnv(envPath = path.resolve(process.cwd(), ".env")): void {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  const parsed = parseDotEnv(contents);

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
