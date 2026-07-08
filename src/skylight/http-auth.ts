import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { UserError } from "toolcraft";

const SERVICE = "skylight-calendar-agent.http-mcp-token";
const ACCOUNT = "default";
const TOKEN_BYTES = 32;
const COMMAND_TIMEOUT_MS = 15_000;

function keychain(args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { if (stdout.length < 4_096) stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { if (stderr.length < 4_096) stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new UserError("macOS Keychain operation timed out."));
    }, COMMAND_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new UserError("Could not invoke macOS Keychain."));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function validateToken(value: string, label: string): string {
  const token = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new UserError(`${label} must be a 256-bit base64url token (43 characters).`);
  }
  return token;
}

export function generateHttpMcpToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export async function readStoredHttpMcpToken(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const result = await keychain(["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"]);
  if (result.code === 44) return null;
  if (result.code !== 0) throw new UserError("Could not read the HTTP MCP token from macOS Keychain.");
  return validateToken(result.stdout.replace(/[\r\n]+$/, ""), "Stored HTTP MCP token");
}

export async function writeStoredHttpMcpToken(token: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new UserError("Persistent HTTP MCP token storage currently requires macOS Keychain.");
  }
  const normalized = validateToken(token, "HTTP MCP token");
  const result = await keychain(
    [
      "add-generic-password", "-U", "-a", ACCOUNT, "-s", SERVICE,
      "-l", "Skylight Calendar HTTP MCP bearer token", "-w",
    ],
    `${normalized}\n${normalized}\n`
  );
  if (result.code !== 0) throw new UserError("Could not store the HTTP MCP token in macOS Keychain.");
}

export async function getOrCreateStoredHttpMcpToken(): Promise<string> {
  const existing = await readStoredHttpMcpToken();
  if (existing !== null) return existing;
  const token = generateHttpMcpToken();
  await writeStoredHttpMcpToken(token);
  return token;
}

export async function rotateStoredHttpMcpToken(): Promise<string> {
  const token = generateHttpMcpToken();
  await writeStoredHttpMcpToken(token);
  return token;
}

export function httpMcpTokenFromEnvironment(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.SKYLIGHT_MCP_HTTP_TOKEN;
  return value === undefined || value.trim().length === 0
    ? null
    : validateToken(value, "SKYLIGHT_MCP_HTTP_TOKEN");
}

export function tokenMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
