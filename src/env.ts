import fs from "node:fs";
import path from "node:path";

const CREDENTIAL_NAMES = new Set([
  "SKYLIGHT_AUTH_HEADER",
  "SKYLIGHT_BASIC_TOKEN",
  "SKYLIGHT_BEARER_TOKEN",
  "SKYLIGHT_EMAIL",
  "SKYLIGHT_PASSWORD",
]);

type ExternalCredentialMethod = "header" | "basic" | "bearer" | "email-password" | null;

function hasNonBlankValue(value: string | undefined): boolean {
  return (value?.trim().length ?? 0) > 0;
}

function externalCredentialMethod(): ExternalCredentialMethod {
  if (hasNonBlankValue(process.env.SKYLIGHT_AUTH_HEADER)) return "header";
  if (hasNonBlankValue(process.env.SKYLIGHT_BASIC_TOKEN)) return "basic";
  if (hasNonBlankValue(process.env.SKYLIGHT_BEARER_TOKEN)) return "bearer";
  if (
    hasNonBlankValue(process.env.SKYLIGHT_EMAIL) ||
    (process.env.SKYLIGHT_PASSWORD?.length ?? 0) > 0
  ) {
    return "email-password";
  }
  return null;
}

function mayLoadDotEnvKey(key: string, method: ExternalCredentialMethod): boolean {
  if (method === null) return true;
  if (key === "SKYLIGHT_API_BASE") return false;
  if (!CREDENTIAL_NAMES.has(key)) return true;
  return method === "email-password" && (key === "SKYLIGHT_EMAIL" || key === "SKYLIGHT_PASSWORD");
}

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

  for (const rawLine of contents.replace(/^\uFEFF/, "").split(/\r?\n/)) {
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
  const credentialMethod = externalCredentialMethod();

  for (const [key, value] of Object.entries(parsed)) {
    if (
      key.startsWith("SKYLIGHT_") &&
      process.env[key] === undefined &&
      mayLoadDotEnvKey(key, credentialMethod)
    ) {
      process.env[key] = value;
    }
  }
}
