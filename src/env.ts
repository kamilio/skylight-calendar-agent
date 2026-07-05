import fs from "node:fs";
import path from "node:path";

function parseQuotedValue(
  value: string,
  quote: '"' | "'"
): { parsed: string; endIndex: number } | null {
  let parsed = "";
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === quote) return { parsed, endIndex: index };
    if (quote === '"' && character === "\\") {
      index += 1;
      if (index >= value.length) return null;
      const escaped = value[index];
      parsed +=
        escaped === "n"
          ? "\n"
          : escaped === "r"
            ? "\r"
            : escaped === "t"
              ? "\t"
              : escaped === "\\" || escaped === '"'
                ? escaped
                : `\\${escaped}`;
      continue;
    }
    parsed += character;
  }
  return null;
}

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
      const quoted = parseQuotedValue(value, '"');
      if (quoted === null) continue;
      const trailing = value.slice(quoted.endIndex + 1).trim();
      if (trailing.length > 0 && !trailing.startsWith("#")) continue;
      value = quoted.parsed;
    } else if (value.startsWith("'")) {
      const quoted = parseQuotedValue(value, "'");
      if (quoted === null) continue;
      const trailing = value.slice(quoted.endIndex + 1).trim();
      if (trailing.length > 0 && !trailing.startsWith("#")) continue;
      value = quoted.parsed;
    } else {
      const commentIndex = value.indexOf("#");
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trimEnd();
    }

    out[key] = value;
  }

  return out;
}

export function loadDotEnv(envPath = path.resolve(process.cwd(), ".env")): void {
  let contents: string;
  try {
    if (!fs.statSync(envPath).isFile()) return;
    contents = fs.readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  const parsed = parseDotEnv(contents);

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
