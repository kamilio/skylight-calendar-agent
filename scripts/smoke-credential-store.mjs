import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMacOSKeychainAuthorizationStore } from "../dist/skylight/credential-store.js";

const env = { SKYLIGHT_API_BASE: "https://example.invalid" };
const directory = await mkdtemp(path.join(tmpdir(), "skylight-credentials-"));
let encryptionKey = null;
let legacyCredential = null;
const calls = [];
const runner = async (args, input) => {
  calls.push({ args, input });
  const operation = args[0];
  const service = args[args.indexOf("-s") + 1];
  if (operation === "find-generic-password") {
    const stored = service.endsWith(".encryption-key") ? encryptionKey : legacyCredential;
    return stored === null
      ? { code: 44, stdout: "", stderr: "not found" }
      : { code: 0, stdout: `${stored}\n`, stderr: "" };
  }
  if (operation === "add-generic-password") {
    const [first, second] = String(input).split("\n");
    if (!first || first !== second) return { code: 1, stdout: "", stderr: "mismatch" };
    if (!service.endsWith(".encryption-key")) throw new Error("Credential was written directly to Keychain");
    encryptionKey = first;
    return { code: 0, stdout: "", stderr: "" };
  }
  if (operation === "delete-generic-password") {
    const current = service.endsWith(".encryption-key") ? encryptionKey : legacyCredential;
    if (current === null) return { code: 44, stdout: "", stderr: "not found" };
    if (service.endsWith(".encryption-key")) encryptionKey = null;
    else legacyCredential = null;
    return { code: 0, stdout: "", stderr: "" };
  }
  throw new Error(`Unexpected Keychain operation ${operation}`);
};

try {
  const store = createMacOSKeychainAuthorizationStore({
    runner,
    service: "test-service",
    storageDirectory: directory,
  });
  if ((await store.read(env)) !== null) throw new Error("Missing credential was not absent");

  const credential = JSON.stringify({
    accessToken: "a".repeat(300),
    refreshToken: "r".repeat(300),
  });
  await store.write(credential, env);
  if (!encryptionKey || Buffer.from(encryptionKey, "base64").length !== 32) {
    throw new Error("A 256-bit encryption key was not stored in Keychain");
  }
  if (calls.some((call) => call.args.includes(credential) || call.input?.includes(credential))) {
    throw new Error("Credential leaked into Keychain command arguments or stdin");
  }

  const [credentialFile] = await import("node:fs/promises").then(({ readdir }) => readdir(directory));
  const filePath = path.join(directory, credentialFile);
  const encrypted = await readFile(filePath, "utf8");
  if (encrypted.includes("a".repeat(50)) || encrypted.includes("r".repeat(50))) {
    throw new Error("Credential file contained plaintext tokens");
  }
  if (((await stat(directory)).mode & 0o777) !== 0o700 || ((await stat(filePath)).mode & 0o777) !== 0o600) {
    throw new Error("Credential storage permissions were not restrictive");
  }

  const freshStore = createMacOSKeychainAuthorizationStore({
    runner,
    service: "test-service",
    storageDirectory: directory,
  });
  if ((await freshStore.read(env)) !== credential) {
    throw new Error("Encrypted credential did not survive a fresh store instance");
  }
  if (!(await freshStore.delete(env)) || encryptionKey !== null) {
    throw new Error("Encrypted credential and Keychain key were not deleted");
  }
  if (await freshStore.delete(env)) throw new Error("Deleting a missing credential should return false");

  legacyCredential = "Bearer legacy-token";
  const migrationStore = createMacOSKeychainAuthorizationStore({
    runner,
    service: "test-service",
    storageDirectory: directory,
  });
  if ((await migrationStore.read(env)) !== legacyCredential) {
    throw new Error("Legacy Keychain credential was not readable");
  }
  await migrationStore.write(credential, env);
  if (legacyCredential !== null) throw new Error("Legacy credential was not removed after migration");

  const failingStore = createMacOSKeychainAuthorizationStore({
    runner: async () => ({ code: 1, stdout: "", stderr: "\u001b[31mdenied\rreplace" }),
    storageDirectory: directory,
  });
  try {
    await failingStore.read(env);
    throw new Error("Failed Keychain read unexpectedly succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("denied replace") || /[\u001b\r]/.test(message)) throw error;
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
