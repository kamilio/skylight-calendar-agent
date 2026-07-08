import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { UserError } from "toolcraft";
import { getSkylightRequestConfig } from "./config.js";
import { terminalSafeText, truncateText } from "./text.js";

const DEFAULT_SERVICE = "skylight-calendar-agent";
const MAX_COMMAND_OUTPUT = 20_000;
const COMMAND_TIMEOUT_MS = 15_000;
const ENCRYPTION_VERSION = 1;

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface EncryptedCredential {
  version: 1;
  iv: string;
  ciphertext: string;
  tag: string;
}

export type CredentialCommandRunner = (
  args: readonly string[],
  input?: string
) => Promise<CommandResult>;

export interface AuthorizationStore {
  readonly name: string;
  read(env?: NodeJS.ProcessEnv): Promise<string | null>;
  write(authorization: string, env?: NodeJS.ProcessEnv): Promise<void>;
  delete(env?: NodeJS.ProcessEnv): Promise<boolean>;
}

function boundedOutput(value: string): string {
  const safe = terminalSafeText(value).trim();
  return safe.length <= 500 ? safe : `${truncateText(safe, 500)}…`;
}

function defaultRunner(command: string): CredentialCommandRunner {
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new UserError("macOS Keychain operation timed out."));
      }, COMMAND_TIMEOUT_MS);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (stdout.length < MAX_COMMAND_OUTPUT) stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < MAX_COMMAND_OUTPUT) stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(new UserError(`macOS Keychain command failed: ${boundedOutput(error.message)}`));
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ code: code ?? 1, stdout, stderr });
      });
      child.stdin.end(input);
    });
}

function credentialFileName(apiBaseUrl: string): string {
  return `${createHash("sha256").update(apiBaseUrl).digest("hex")}.json`;
}

function encryptCredential(value: string, key: Buffer): EncryptedCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: ENCRYPTION_VERSION,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptCredential(payload: EncryptedCredential, key: Buffer): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new UserError("The stored Skylight credential could not be decrypted. Run `skylight auth login` again.");
  }
}

function parseEncryptedCredential(value: string): EncryptedCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new UserError("The encrypted Skylight credential file is invalid. Run `skylight auth login` again.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserError("The encrypted Skylight credential file is invalid. Run `skylight auth login` again.");
  }
  const record = parsed as Partial<EncryptedCredential>;
  if (
    record.version !== ENCRYPTION_VERSION ||
    typeof record.iv !== "string" ||
    typeof record.ciphertext !== "string" ||
    typeof record.tag !== "string"
  ) {
    throw new UserError("The encrypted Skylight credential file is invalid. Run `skylight auth login` again.");
  }
  return record as EncryptedCredential;
}

export function createMacOSKeychainAuthorizationStore(options: {
  command?: string;
  runner?: CredentialCommandRunner;
  service?: string;
  storageDirectory?: string;
} = {}): AuthorizationStore {
  const command = options.command ?? "/usr/bin/security";
  const run = options.runner ?? defaultRunner(command);
  const service = options.service ?? DEFAULT_SERVICE;
  const keyService = `${service}.encryption-key`;
  const storageDirectory =
    options.storageDirectory ??
    path.join(homedir(), "Library", "Application Support", "skylight-calendar-agent", "credentials");
  const account = (env: NodeJS.ProcessEnv): string => getSkylightRequestConfig(env).apiBaseUrl;
  const filePath = (apiBaseUrl: string): string => path.join(storageDirectory, credentialFileName(apiBaseUrl));
  const cache = new Map<string, string>();

  const readKey = async (apiBaseUrl: string): Promise<Buffer | null> => {
    const result = await run(["find-generic-password", "-a", apiBaseUrl, "-s", keyService, "-w"]);
    if (result.code === 44) return null;
    if (result.code !== 0) {
      throw new UserError(
        `Could not read the Skylight encryption key from macOS Keychain: ${boundedOutput(result.stderr) || `exit code ${result.code}`}.`
      );
    }
    const key = Buffer.from(result.stdout.replace(/[\r\n]+$/, ""), "base64");
    if (key.length !== 32) {
      throw new UserError("The Skylight encryption key in macOS Keychain is invalid. Run `skylight auth login` again.");
    }
    return key;
  };

  const writeKey = async (apiBaseUrl: string, key: Buffer): Promise<void> => {
    const encoded = key.toString("base64");
    const result = await run(
      [
        "add-generic-password",
        "-U",
        "-a",
        apiBaseUrl,
        "-s",
        keyService,
        "-l",
        `Skylight Calendar credential encryption key for ${apiBaseUrl}`,
        "-w",
      ],
      `${encoded}\n${encoded}\n`
    );
    if (result.code !== 0) {
      throw new UserError(
        `Could not store the Skylight encryption key in macOS Keychain: ${boundedOutput(result.stderr) || `exit code ${result.code}`}.`
      );
    }
  };

  const readLegacy = async (apiBaseUrl: string): Promise<string | null> => {
    const result = await run(["find-generic-password", "-a", apiBaseUrl, "-s", service, "-w"]);
    if (result.code === 44) return null;
    if (result.code !== 0) {
      throw new UserError(
        `Could not read the stored Skylight credential from macOS Keychain: ${boundedOutput(result.stderr) || `exit code ${result.code}`}.`
      );
    }
    return result.stdout.replace(/[\r\n]+$/, "");
  };

  const deleteKeychainItem = async (apiBaseUrl: string, itemService: string): Promise<boolean> => {
    const result = await run(["delete-generic-password", "-a", apiBaseUrl, "-s", itemService]);
    if (result.code === 44) return false;
    if (result.code !== 0) {
      throw new UserError(
        `Could not remove the stored Skylight credential from macOS Keychain: ${boundedOutput(result.stderr) || `exit code ${result.code}`}.`
      );
    }
    return true;
  };

  return {
    name: "macOS Keychain",
    async read(env = process.env) {
      const apiBaseUrl = account(env);
      const cached = cache.get(apiBaseUrl);
      if (cached !== undefined) return cached;
      const key = await readKey(apiBaseUrl);
      if (key !== null) {
        try {
          const encrypted = await readFile(filePath(apiBaseUrl), "utf8");
          const credential = decryptCredential(parseEncryptedCredential(encrypted), key);
          cache.set(apiBaseUrl, credential);
          return credential;
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        }
      }
      const legacy = await readLegacy(apiBaseUrl);
      if (legacy !== null) cache.set(apiBaseUrl, legacy);
      return legacy;
    },
    async write(authorization, env = process.env) {
      const apiBaseUrl = account(env);
      let key = await readKey(apiBaseUrl);
      if (key === null) {
        key = randomBytes(32);
        await writeKey(apiBaseUrl, key);
      }
      const encrypted = `${JSON.stringify(encryptCredential(authorization, key))}\n`;
      await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
      await chmod(storageDirectory, 0o700);
      const destination = filePath(apiBaseUrl);
      const temporary = `${destination}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temporary, encrypted, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
      await deleteKeychainItem(apiBaseUrl, service);
      cache.set(apiBaseUrl, authorization);
    },
    async delete(env = process.env) {
      const apiBaseUrl = account(env);
      cache.delete(apiBaseUrl);
      let removedFile = false;
      try {
        await rm(filePath(apiBaseUrl));
        removedFile = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      }
      const removedKey = await deleteKeychainItem(apiBaseUrl, keyService);
      const removedLegacy = await deleteKeychainItem(apiBaseUrl, service);
      return removedFile || removedKey || removedLegacy;
    },
  };
}

export function createFileAuthorizationStore(options: {
  storageDirectory?: string;
} = {}): AuthorizationStore {
  const storageDirectory =
    options.storageDirectory ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"), "skylight-calendar-agent", "credentials");
  const account = (env: NodeJS.ProcessEnv): string => getSkylightRequestConfig(env).apiBaseUrl;
  const filePath = (apiBaseUrl: string): string => path.join(storageDirectory, credentialFileName(apiBaseUrl));
  const cache = new Map<string, string>();

  return {
    name: "user credential file",
    async read(env = process.env) {
      const apiBaseUrl = account(env);
      const cached = cache.get(apiBaseUrl);
      if (cached !== undefined) return cached;
      try {
        const credential = (await readFile(filePath(apiBaseUrl), "utf8")).replace(/\r?\n$/, "");
        cache.set(apiBaseUrl, credential);
        return credential;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
        throw error;
      }
    },
    async write(authorization, env = process.env) {
      const apiBaseUrl = account(env);
      await mkdir(storageDirectory, { recursive: true, mode: 0o700 });
      await chmod(storageDirectory, 0o700);
      const destination = filePath(apiBaseUrl);
      const temporary = `${destination}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temporary, `${authorization}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, destination);
        await chmod(destination, 0o600);
      } finally {
        await rm(temporary, { force: true });
      }
      cache.set(apiBaseUrl, authorization);
    },
    async delete(env = process.env) {
      const apiBaseUrl = account(env);
      cache.delete(apiBaseUrl);
      try {
        await rm(filePath(apiBaseUrl));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
        throw error;
      }
    },
  };
}

export function systemAuthorizationStore(): AuthorizationStore | null {
  return process.platform === "darwin" ? macOSSystemStore : fileSystemStore;
}

const macOSSystemStore = createMacOSKeychainAuthorizationStore();
const fileSystemStore = createFileAuthorizationStore();
