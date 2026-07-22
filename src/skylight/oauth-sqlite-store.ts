import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import {
  chmodSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuthorizationServerStore } from "toolcraft/http";
import type {
  HostedOAuthCredentialStore,
  HostedOAuthInteractionStore,
  HostedOAuthStorage,
} from "toolcraft/http/hosted-oauth";
import {
  parseOAuthCredential,
  serializeOAuthCredential,
  type StoredOAuthCredential,
} from "./oauth.js";

type OAuthClientRecord = Parameters<AuthorizationServerStore["putClient"]>[0];
type AuthorizationTransactionRecord = Parameters<
  AuthorizationServerStore["putAuthorizationTransaction"]
>[0];
type AuthorizationCodeRecord = Parameters<
  AuthorizationServerStore["putAuthorizationCode"]
>[0];
type AuthorizationGrantRecord = Parameters<AuthorizationServerStore["putGrant"]>[0];
type AccessTokenRecord = Parameters<AuthorizationServerStore["putAccessToken"]>[0];
type RefreshTokenRecord = Parameters<AuthorizationServerStore["putRefreshToken"]>[0];
type RefreshTokenRotationResult = Awaited<
  ReturnType<AuthorizationServerStore["rotateRefreshToken"]>
>;
type HostedOAuthSigningKey = Awaited<
  ReturnType<HostedOAuthStorage<StoredOAuthCredential>["signingKey"]>
>;

export interface SQLiteSkylightOAuthStoreOptions {
  /** Persistent local file. SQLite memory databases are intentionally rejected. */
  databasePath: string;
  /** Exactly 32 bytes; keep this value in a deployment secret. */
  encryptionKey: Uint8Array;
  /** Stable P-256 private key used to sign the hosted authorization server's tokens. */
  signingPrivateKey: KeyObject;
  /** Exactly 32 bytes and distinct from the credential encryption key. */
  subjectKey: Uint8Array;
  namespace?: string;
  encryptionKeyId?: string;
  /** Old key IDs may be retained here while encrypted values are migrated. */
  decryptionKeys?: Readonly<Record<string, Uint8Array>>;
  now?: () => number;
  /** Maximum time SQLite waits for another local writer. Defaults to five seconds. */
  busyTimeoutMs?: number;
  /** Sliding lifetime for inactive dynamically registered clients. Defaults to 90 days. */
  clientRetentionMs?: number;
  /** Sliding lifetime beyond the last grant/token activity. Defaults to 90 days. */
  grantRetentionMs?: number;
}

export interface LoadedSQLiteSkylightCredential {
  authorization: string;
  credential: StoredOAuthCredential;
  version: number;
  updatedAt: number;
}

export type SQLiteCredentialSaveResult =
  | { saved: true; version: number; updatedAt: number }
  | { saved: false; currentVersion: number };

interface EncryptedCredentialRow {
  credentialVersion: number;
  updatedAt: number;
  keyId: string;
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

const DEFAULT_NAMESPACE = "skylight-calendar-agent";
const SKYLIGHT_OAUTH_PROVIDER_NAME = "Skylight";
const SCHEMA_VERSION = 1;
const APPLICATION_ID = 0x534b4f41; // "SKOA"
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const DEFAULT_CLIENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const DEFAULT_GRANT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const MAX_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;
const CREDENTIAL_UPDATE_LEASE_TTL_MS = 60_000;
const CREDENTIAL_UPDATE_WAIT_TIMEOUT_MS = 120_000;
const CREDENTIAL_UPDATE_RETRY_MIN_MS = 10;
const CREDENTIAL_UPDATE_RETRY_MAX_MS = 250;

const SCHEMA = String.raw`
CREATE TABLE sk_oauth_store_metadata (
  namespace TEXT PRIMARY KEY,
  signing_key_id TEXT NOT NULL,
  subject_key_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sk_oauth_clients (
  namespace TEXT NOT NULL,
  client_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, client_id)
) STRICT;
CREATE INDEX sk_oauth_clients_expiry
  ON sk_oauth_clients (namespace, expires_at);

CREATE TABLE sk_oauth_transactions (
  namespace TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, transaction_id)
) STRICT;
CREATE INDEX sk_oauth_transactions_expiry
  ON sk_oauth_transactions (namespace, expires_at);

CREATE TABLE sk_oauth_grants (
  namespace TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  revoked_at INTEGER,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, grant_id)
) STRICT;
CREATE INDEX sk_oauth_grants_expiry
  ON sk_oauth_grants (namespace, expires_at);

CREATE TABLE sk_oauth_codes (
  namespace TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, token_hash),
  FOREIGN KEY (namespace, grant_id)
    REFERENCES sk_oauth_grants (namespace, grant_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX sk_oauth_codes_expiry
  ON sk_oauth_codes (namespace, expires_at);

CREATE TABLE sk_oauth_access_tokens (
  namespace TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (namespace, token_hash),
  FOREIGN KEY (namespace, grant_id)
    REFERENCES sk_oauth_grants (namespace, grant_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX sk_oauth_access_expiry
  ON sk_oauth_access_tokens (namespace, expires_at);
CREATE INDEX sk_oauth_access_grant
  ON sk_oauth_access_tokens (namespace, grant_id);

CREATE TABLE sk_oauth_refresh_tokens (
  namespace TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  family_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'rotated', 'revoked')),
  PRIMARY KEY (namespace, token_hash),
  FOREIGN KEY (namespace, grant_id)
    REFERENCES sk_oauth_grants (namespace, grant_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX sk_oauth_refresh_expiry
  ON sk_oauth_refresh_tokens (namespace, expires_at);
CREATE INDEX sk_oauth_refresh_family
  ON sk_oauth_refresh_tokens (namespace, family_id);
CREATE INDEX sk_oauth_refresh_grant
  ON sk_oauth_refresh_tokens (namespace, grant_id);

CREATE TABLE sk_oauth_credentials (
  namespace TEXT NOT NULL,
  subject TEXT NOT NULL,
  credential_version INTEGER NOT NULL CHECK (credential_version > 0),
  updated_at INTEGER NOT NULL,
  key_id TEXT NOT NULL,
  iv BLOB NOT NULL CHECK (length(iv) = 12),
  ciphertext BLOB NOT NULL,
  tag BLOB NOT NULL CHECK (length(tag) = 16),
  PRIMARY KEY (namespace, subject)
) STRICT;

CREATE TABLE sk_oauth_credential_leases (
  namespace TEXT NOT NULL,
  subject TEXT NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (namespace, subject)
) STRICT;
CREATE INDEX sk_oauth_credential_leases_expiry
  ON sk_oauth_credential_leases (namespace, expires_at);
`;

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} is required.`);
  if (value.length > 4_096) throw new Error(`${label} is too long.`);
}

function normalizedNamespace(value: string): string {
  const namespace = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(namespace)) {
    throw new Error(
      "SQLite namespace must contain only letters, numbers, dots, underscores, and hyphens."
    );
  }
  return namespace;
}

function normalizedDatabasePath(value: string): string {
  assertNonEmpty(value, "SQLite database path");
  if (value !== value.trim()) {
    throw new Error("SQLite database path must not have surrounding whitespace.");
  }
  if (value === ":memory:" || value.startsWith("file:")) {
    throw new Error("Hosted OAuth requires a persistent SQLite database file.");
  }
  return path.resolve(value);
}

function keyBytes(value: Uint8Array, label: string): Buffer {
  const key = Buffer.from(value);
  if (key.length !== 32) throw new Error(`${label} must contain exactly 32 bytes.`);
  return key;
}

function hostedOAuthSigningKey(privateKey: KeyObject): HostedOAuthSigningKey {
  if (
    privateKey.type !== "private" ||
    privateKey.asymmetricKeyType !== "ec" ||
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error("Hosted OAuth signing private key must be a P-256 EC private key.");
  }
  const publicKey = createPublicKey(privateKey);
  const keyId = createHash("sha256")
    .update(publicKey.export({ format: "der", type: "spki" }))
    .digest("base64url")
    .slice(0, 22);
  return {
    algorithm: "ES256",
    keyId,
    privateKey,
    publicJwk: publicKey.export({ format: "jwk" }),
  };
}

function assertKeyId(value: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new Error(
      "Credential encryption key ID must contain only letters, numbers, dots, underscores, and hyphens."
    );
  }
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeTimestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function retentionMilliseconds(value: number, label: string): number {
  const milliseconds = positiveInteger(value, label);
  if (milliseconds > MAX_RETENTION_MS) {
    throw new Error(`${label} must not exceed 365 days.`);
  }
  return milliseconds;
}

function expectedVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function jsonRecord<T>(raw: string, label: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`SQLite contained an invalid ${label} record.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`SQLite contained an invalid ${label} record.`);
  }
  return parsed as T;
}

function requiredString(
  row: Readonly<Record<string, unknown>>,
  column: string,
  label: string
): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`SQLite contained an invalid ${label}.`);
  return value;
}

function requiredInteger(
  row: Readonly<Record<string, unknown>>,
  column: string,
  label: string
): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`SQLite contained an invalid ${label}.`);
  }
  return value;
}

function optionalInteger(
  row: Readonly<Record<string, unknown>>,
  column: string,
  label: string
): number | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`SQLite contained an invalid ${label}.`);
  }
  return value;
}

function requiredBytes(
  row: Readonly<Record<string, unknown>>,
  column: string,
  label: string
): Buffer {
  const value = row[column];
  if (!(value instanceof Uint8Array)) {
    throw new Error(`SQLite contained an invalid ${label}.`);
  }
  return Buffer.from(value);
}

function recordFromRow<T>(row: Readonly<Record<string, unknown>>, label: string): T {
  return jsonRecord<T>(requiredString(row, "record_json", `${label} JSON`), label);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Durable, encrypted, single-machine SQLite storage for Toolcraft hosted OAuth.
 * The database file must live on persistent local storage and must not be shared
 * by multiple Fly machines.
 */
export class SQLiteSkylightOAuthStore
  implements AuthorizationServerStore, HostedOAuthStorage<StoredOAuthCredential>
{
  readonly databasePath: string;
  readonly namespace: string;
  readonly encryptionKeyId: string;
  readonly authorizationServer: AuthorizationServerStore = this;
  readonly capabilities = Object.freeze({
    durable: true,
    encryptedCredentials: true,
    stableKeys: true,
    shared: false,
  });
  readonly interactions: HostedOAuthInteractionStore = {
    set: (transaction) => this.putAuthorizationTransaction(transaction),
    get: (transactionId) => this.getAuthorizationTransaction(transactionId),
    delete: async (transactionId) => {
      this.#assertOpen();
      assertNonEmpty(transactionId, "Authorization transaction ID");
      this.#database
        .prepare(
          "DELETE FROM sk_oauth_transactions WHERE namespace = ? AND transaction_id = ?"
        )
        .run(this.namespace, transactionId);
    },
  };
  readonly credentials: HostedOAuthCredentialStore<StoredOAuthCredential> = {
    get: async (subject) => this.#loadCredential(subject)?.credential,
    set: (subject, credential) => this.#setHostedCredential(subject, credential),
    delete: (subject) => this.#deleteHostedCredential(subject),
    update: (subject, update) => this.#updateHostedCredential(subject, update),
  };

  readonly #database: DatabaseSync;
  readonly #currentKey: Buffer;
  readonly #decryptionKeys = new Map<string, Buffer>();
  readonly #clientRetentionMs: number;
  readonly #grantRetentionMs: number;
  readonly #now: () => number;
  readonly #signingKey: HostedOAuthSigningKey;
  readonly #subjectKey: Buffer;
  #activeCredentialUpdates = 0;
  #closed = false;

  constructor(options: SQLiteSkylightOAuthStoreOptions) {
    this.databasePath = normalizedDatabasePath(options.databasePath);
    this.namespace = normalizedNamespace(options.namespace ?? DEFAULT_NAMESPACE);
    this.#currentKey = keyBytes(options.encryptionKey, "Credential encryption key");
    this.#subjectKey = keyBytes(options.subjectKey, "Hosted OAuth subject key");
    if (this.#subjectKey.equals(this.#currentKey)) {
      throw new Error(
        "Hosted OAuth subject key must be distinct from the credential encryption key."
      );
    }
    this.#signingKey = hostedOAuthSigningKey(options.signingPrivateKey);
    this.encryptionKeyId =
      options.encryptionKeyId ?? digest(this.#currentKey).slice(0, 20);
    assertKeyId(this.encryptionKeyId);
    for (const [keyId, value] of Object.entries(options.decryptionKeys ?? {})) {
      assertKeyId(keyId);
      this.#decryptionKeys.set(keyId, keyBytes(value, `Decryption key ${keyId}`));
    }
    this.#decryptionKeys.set(this.encryptionKeyId, this.#currentKey);
    this.#now = options.now ?? Date.now;
    const busyTimeoutMs = positiveInteger(
      options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
      "SQLite busy timeout"
    );
    this.#clientRetentionMs = retentionMilliseconds(
      options.clientRetentionMs ?? DEFAULT_CLIENT_RETENTION_MS,
      "OAuth client retention"
    );
    this.#grantRetentionMs = retentionMilliseconds(
      options.grantRetentionMs ?? DEFAULT_GRANT_RETENTION_MS,
      "OAuth grant retention"
    );

    mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(this.databasePath);
    this.#database = database;
    try {
      database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
      database.exec("PRAGMA foreign_keys = ON");
      database.exec("PRAGMA trusted_schema = OFF");
      database.exec("PRAGMA synchronous = FULL");
      database.exec("PRAGMA secure_delete = ON");
      database.exec("PRAGMA wal_autocheckpoint = 1000");
      const journal = database.prepare("PRAGMA journal_mode = WAL").get();
      if (requiredString(journal ?? {}, "journal_mode", "journal mode") !== "wal") {
        throw new Error("Hosted OAuth SQLite storage requires WAL journal mode.");
      }
      const foreignKeys = database.prepare("PRAGMA foreign_keys").get();
      if (requiredInteger(foreignKeys ?? {}, "foreign_keys", "foreign-key setting") !== 1) {
        throw new Error("Hosted OAuth SQLite storage requires foreign keys.");
      }
      this.#initializeSchema();
      this.#initializeNamespaceMetadata();
      this.#secureDatabaseFiles();
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async signingKey(): Promise<HostedOAuthSigningKey> {
    this.#assertOpen();
    return this.#signingKey;
  }

  async resolveSubject(providerName: string, accountId: string): Promise<string> {
    this.#assertOpen();
    if (providerName !== SKYLIGHT_OAUTH_PROVIDER_NAME) {
      throw new Error(
        `Hosted OAuth provider name must remain exactly ${JSON.stringify(
          SKYLIGHT_OAUTH_PROVIDER_NAME
        )}.`
      );
    }
    assertNonEmpty(accountId, "Hosted OAuth provider account ID");
    if (accountId !== accountId.trim()) {
      throw new Error("Hosted OAuth provider account ID must not have surrounding whitespace.");
    }
    return createHmac("sha256", this.#subjectKey)
      .update(providerName)
      .update("\0")
      .update(accountId)
      .digest("base64url");
  }

  async cleanup(now = this.#now()): Promise<void> {
    const cutoff = safeTimestamp(now, "OAuth cleanup time");
    this.#transaction(() => {
      this.#database
        .prepare("DELETE FROM sk_oauth_transactions WHERE namespace = ? AND expires_at <= ?")
        .run(this.namespace, cutoff);
      this.#database
        .prepare("DELETE FROM sk_oauth_codes WHERE namespace = ? AND expires_at <= ?")
        .run(this.namespace, cutoff);
      this.#database
        .prepare("DELETE FROM sk_oauth_access_tokens WHERE namespace = ? AND expires_at <= ?")
        .run(this.namespace, cutoff);
      this.#database
        .prepare("DELETE FROM sk_oauth_refresh_tokens WHERE namespace = ? AND expires_at <= ?")
        .run(this.namespace, cutoff);
      this.#database
        .prepare("DELETE FROM sk_oauth_grants WHERE namespace = ? AND expires_at <= ?")
        .run(this.namespace, cutoff);
      this.#database
        .prepare("DELETE FROM sk_oauth_clients WHERE namespace = ? AND expires_at <= ?")
        .run(this.namespace, cutoff);
      this.#database
        .prepare("DELETE FROM sk_oauth_credential_leases WHERE namespace = ? AND expires_at <= ?")
        .run(this.namespace, cutoff);
    });
  }

  async putClient(client: OAuthClientRecord): Promise<void> {
    this.#assertOpen();
    assertNonEmpty(client.id, "OAuth client ID");
    this.#database
      .prepare(
        `INSERT INTO sk_oauth_clients
           (namespace, client_id, record_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (namespace, client_id) DO UPDATE SET
           record_json = excluded.record_json,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(
        this.namespace,
        client.id,
        JSON.stringify(client),
        safeTimestamp(client.createdAt, "OAuth client creation time"),
        this.#retentionDeadline(this.#recordNow(), this.#clientRetentionMs)
      );
  }

  async getClient(clientId: string): Promise<OAuthClientRecord | undefined> {
    this.#assertOpen();
    assertNonEmpty(clientId, "OAuth client ID");
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT record_json, expires_at
             FROM sk_oauth_clients
            WHERE namespace = ? AND client_id = ?`
        )
        .get(this.namespace, clientId);
      if (row === undefined) return undefined;
      const now = this.#recordNow();
      if (requiredInteger(row, "expires_at", "OAuth client expiration") <= now) {
        this.#database
          .prepare("DELETE FROM sk_oauth_clients WHERE namespace = ? AND client_id = ?")
          .run(this.namespace, clientId);
        return undefined;
      }
      this.#database
        .prepare(
          `UPDATE sk_oauth_clients
              SET expires_at = ?
            WHERE namespace = ? AND client_id = ?`
        )
        .run(
          this.#retentionDeadline(now, this.#clientRetentionMs),
          this.namespace,
          clientId
        );
      return recordFromRow<OAuthClientRecord>(row, "OAuth client");
    });
  }

  async putAuthorizationTransaction(
    transaction: AuthorizationTransactionRecord
  ): Promise<void> {
    this.#assertOpen();
    assertNonEmpty(transaction.id, "Authorization transaction ID");
    this.#database
      .prepare(
        `INSERT INTO sk_oauth_transactions
           (namespace, transaction_id, record_json, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (namespace, transaction_id) DO UPDATE SET
           record_json = excluded.record_json,
           expires_at = excluded.expires_at`
      )
      .run(
        this.namespace,
        transaction.id,
        JSON.stringify(transaction),
        safeTimestamp(transaction.expiresAt, "Authorization transaction expiration time")
      );
  }

  async getAuthorizationTransaction(
    transactionId: string
  ): Promise<AuthorizationTransactionRecord | undefined> {
    this.#assertOpen();
    assertNonEmpty(transactionId, "Authorization transaction ID");
    const row = this.#database
      .prepare(
        `SELECT record_json, expires_at
           FROM sk_oauth_transactions
          WHERE namespace = ? AND transaction_id = ?`
      )
      .get(this.namespace, transactionId);
    if (row === undefined) return undefined;
    if (requiredInteger(row, "expires_at", "authorization transaction expiration") <= this.#recordNow()) {
      this.#database
        .prepare(
          "DELETE FROM sk_oauth_transactions WHERE namespace = ? AND transaction_id = ?"
        )
        .run(this.namespace, transactionId);
      return undefined;
    }
    return recordFromRow<AuthorizationTransactionRecord>(row, "authorization transaction");
  }

  async takeAuthorizationTransaction(
    transactionId: string
  ): Promise<AuthorizationTransactionRecord | undefined> {
    assertNonEmpty(transactionId, "Authorization transaction ID");
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT record_json, expires_at
             FROM sk_oauth_transactions
            WHERE namespace = ? AND transaction_id = ?`
        )
        .get(this.namespace, transactionId);
      if (row === undefined) return undefined;
      this.#database
        .prepare(
          "DELETE FROM sk_oauth_transactions WHERE namespace = ? AND transaction_id = ?"
        )
        .run(this.namespace, transactionId);
      if (requiredInteger(row, "expires_at", "authorization transaction expiration") <= this.#recordNow()) {
        return undefined;
      }
      return recordFromRow<AuthorizationTransactionRecord>(row, "authorization transaction");
    });
  }

  async putAuthorizationCode(code: AuthorizationCodeRecord): Promise<void> {
    this.#assertOpen();
    assertNonEmpty(code.tokenHash, "Authorization code hash");
    assertNonEmpty(code.grantId, "Authorization grant ID");
    const expiresAt = safeTimestamp(code.expiresAt, "Authorization code expiration time");
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO sk_oauth_codes
             (namespace, token_hash, grant_id, record_json, expires_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(this.namespace, code.tokenHash, code.grantId, JSON.stringify(code), expiresAt);
      this.#touchGrant(code.grantId, expiresAt);
    });
  }

  async takeAuthorizationCode(
    tokenHash: string
  ): Promise<AuthorizationCodeRecord | undefined> {
    assertNonEmpty(tokenHash, "Authorization code hash");
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT record_json, expires_at
             FROM sk_oauth_codes
            WHERE namespace = ? AND token_hash = ?`
        )
        .get(this.namespace, tokenHash);
      if (row === undefined) return undefined;
      this.#database
        .prepare("DELETE FROM sk_oauth_codes WHERE namespace = ? AND token_hash = ?")
        .run(this.namespace, tokenHash);
      if (requiredInteger(row, "expires_at", "authorization code expiration") <= this.#recordNow()) {
        return undefined;
      }
      return recordFromRow<AuthorizationCodeRecord>(row, "authorization code");
    });
  }

  async putGrant(grant: AuthorizationGrantRecord): Promise<void> {
    this.#assertOpen();
    assertNonEmpty(grant.id, "Authorization grant ID");
    const revokedAt =
      grant.revokedAt === undefined
        ? null
        : safeTimestamp(grant.revokedAt, "Authorization grant revocation time");
    this.#database
      .prepare(
        `INSERT INTO sk_oauth_grants
           (namespace, grant_id, record_json, revoked_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (namespace, grant_id) DO UPDATE SET
           record_json = excluded.record_json,
           revoked_at = COALESCE(sk_oauth_grants.revoked_at, excluded.revoked_at),
           expires_at = MAX(sk_oauth_grants.expires_at, excluded.expires_at)`
      )
      .run(
        this.namespace,
        grant.id,
        JSON.stringify(grant),
        revokedAt,
        this.#retentionDeadline(this.#recordNow(), this.#grantRetentionMs)
      );
  }

  async getGrant(grantId: string): Promise<AuthorizationGrantRecord | undefined> {
    this.#assertOpen();
    assertNonEmpty(grantId, "Authorization grant ID");
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT record_json, revoked_at, expires_at
             FROM sk_oauth_grants
            WHERE namespace = ? AND grant_id = ?`
        )
        .get(this.namespace, grantId);
      if (row === undefined) return undefined;
      const now = this.#recordNow();
      if (requiredInteger(row, "expires_at", "authorization grant expiration") <= now) {
        this.#database
          .prepare("DELETE FROM sk_oauth_grants WHERE namespace = ? AND grant_id = ?")
          .run(this.namespace, grantId);
        return undefined;
      }
      this.#touchGrant(grantId, now);
      return this.#grantFromRow(row);
    });
  }

  async putAccessToken(token: AccessTokenRecord): Promise<void> {
    this.#assertOpen();
    assertNonEmpty(token.tokenHash, "Access token hash");
    assertNonEmpty(token.grantId, "Authorization grant ID");
    const revokedAt =
      token.revokedAt === undefined
        ? null
        : safeTimestamp(token.revokedAt, "Access token revocation time");
    const expiresAt = safeTimestamp(token.expiresAt, "Access token expiration time");
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO sk_oauth_access_tokens
             (namespace, token_hash, grant_id, record_json, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          this.namespace,
          token.tokenHash,
          token.grantId,
          JSON.stringify(token),
          expiresAt,
          revokedAt
        );
      this.#touchGrant(token.grantId, expiresAt);
    });
  }

  async getAccessToken(tokenHash: string): Promise<AccessTokenRecord | undefined> {
    this.#assertOpen();
    assertNonEmpty(tokenHash, "Access token hash");
    const row = this.#database
      .prepare(
        `SELECT record_json, expires_at, revoked_at
           FROM sk_oauth_access_tokens
          WHERE namespace = ? AND token_hash = ?`
      )
      .get(this.namespace, tokenHash);
    if (row === undefined) return undefined;
    if (requiredInteger(row, "expires_at", "access token expiration") <= this.#recordNow()) {
      this.#database
        .prepare("DELETE FROM sk_oauth_access_tokens WHERE namespace = ? AND token_hash = ?")
        .run(this.namespace, tokenHash);
      return undefined;
    }
    return this.#accessTokenFromRow(row);
  }

  async putRefreshToken(token: RefreshTokenRecord): Promise<void> {
    this.#assertOpen();
    assertNonEmpty(token.tokenHash, "Refresh token hash");
    assertNonEmpty(token.familyId, "Refresh token family ID");
    assertNonEmpty(token.grantId, "Authorization grant ID");
    const expiresAt = safeTimestamp(token.expiresAt, "Refresh token expiration time");
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO sk_oauth_refresh_tokens
             (namespace, token_hash, family_id, grant_id, record_json, expires_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this.namespace,
          token.tokenHash,
          token.familyId,
          token.grantId,
          JSON.stringify(token),
          expiresAt,
          token.status
        );
      this.#touchGrant(token.grantId, expiresAt);
    });
  }

  /** Extended read used by focused diagnostics and refresh-family tests. */
  async getRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | undefined> {
    this.#assertOpen();
    assertNonEmpty(tokenHash, "Refresh token hash");
    const row = this.#database
      .prepare(
        `SELECT record_json, expires_at, status
           FROM sk_oauth_refresh_tokens
          WHERE namespace = ? AND token_hash = ?`
      )
      .get(this.namespace, tokenHash);
    if (row === undefined) return undefined;
    if (requiredInteger(row, "expires_at", "refresh token expiration") <= this.#recordNow()) {
      this.#database
        .prepare("DELETE FROM sk_oauth_refresh_tokens WHERE namespace = ? AND token_hash = ?")
        .run(this.namespace, tokenHash);
      return undefined;
    }
    return this.#refreshTokenFromRow(row);
  }

  async rotateRefreshToken(
    tokenHash: string,
    replacementTokenHash: string,
    now: number,
    expiresAt: number
  ): Promise<RefreshTokenRotationResult> {
    assertNonEmpty(tokenHash, "Refresh token hash");
    assertNonEmpty(replacementTokenHash, "Replacement refresh token hash");
    if (tokenHash === replacementTokenHash) return { status: "invalid" };
    const rotationTime = safeTimestamp(now, "Refresh token rotation time");
    const replacementExpiresAt = safeTimestamp(
      expiresAt,
      "Replacement refresh token expiration time"
    );
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT record_json, family_id, grant_id, expires_at, status
             FROM sk_oauth_refresh_tokens
            WHERE namespace = ? AND token_hash = ?`
        )
        .get(this.namespace, tokenHash);
      if (row === undefined) return { status: "invalid" };
      if (requiredInteger(row, "expires_at", "refresh token expiration") <= this.#recordNow()) {
        this.#database
          .prepare("DELETE FROM sk_oauth_refresh_tokens WHERE namespace = ? AND token_hash = ?")
          .run(this.namespace, tokenHash);
        return { status: "invalid" };
      }
      const previous = this.#refreshTokenFromRow(row);
      if (previous.status === "rotated") {
        this.#revokeGrantRows(previous.grantId, rotationTime);
        return { status: "replay" };
      }
      if (previous.status !== "active") return { status: "invalid" };

      const replacementRow = this.#database
        .prepare(
          `SELECT expires_at
             FROM sk_oauth_refresh_tokens
            WHERE namespace = ? AND token_hash = ?`
        )
        .get(this.namespace, replacementTokenHash);
      if (replacementRow !== undefined) {
        if (
          requiredInteger(replacementRow, "expires_at", "refresh token expiration") <=
          this.#recordNow()
        ) {
          this.#database
            .prepare("DELETE FROM sk_oauth_refresh_tokens WHERE namespace = ? AND token_hash = ?")
            .run(this.namespace, replacementTokenHash);
        } else {
          return { status: "invalid" };
        }
      }

      const changed = this.#database
        .prepare(
          `UPDATE sk_oauth_refresh_tokens
              SET status = 'rotated'
            WHERE namespace = ? AND token_hash = ? AND status = 'active'`
        )
        .run(this.namespace, tokenHash);
      if (Number(changed.changes) !== 1) return { status: "invalid" };

      const replacement: RefreshTokenRecord = {
        ...previous,
        tokenHash: replacementTokenHash,
        createdAt: rotationTime,
        expiresAt: replacementExpiresAt,
        status: "active",
      };
      this.#database
        .prepare(
          `INSERT INTO sk_oauth_refresh_tokens
             (namespace, token_hash, family_id, grant_id, record_json, expires_at, status)
           VALUES (?, ?, ?, ?, ?, ?, 'active')`
        )
        .run(
          this.namespace,
          replacement.tokenHash,
          replacement.familyId,
          replacement.grantId,
          JSON.stringify(replacement),
          replacement.expiresAt
        );
      this.#touchGrant(replacement.grantId, replacement.expiresAt);
      return { status: "rotated", previous };
    });
  }

  async revokeToken(tokenHash: string, now: number): Promise<void> {
    assertNonEmpty(tokenHash, "OAuth token hash");
    const revocationTime = safeTimestamp(now, "OAuth token revocation time");
    this.#transaction(() => {
      const refresh = this.#database
        .prepare(
          `SELECT grant_id, expires_at
             FROM sk_oauth_refresh_tokens
            WHERE namespace = ? AND token_hash = ?`
        )
        .get(this.namespace, tokenHash);
      if (refresh !== undefined) {
        if (requiredInteger(refresh, "expires_at", "refresh token expiration") > this.#recordNow()) {
          this.#revokeGrantRows(
            requiredString(refresh, "grant_id", "refresh token grant ID"),
            revocationTime
          );
          return;
        }
        this.#database
          .prepare("DELETE FROM sk_oauth_refresh_tokens WHERE namespace = ? AND token_hash = ?")
          .run(this.namespace, tokenHash);
      }
      this.#database
        .prepare(
          `UPDATE sk_oauth_access_tokens
              SET revoked_at = COALESCE(revoked_at, ?)
            WHERE namespace = ? AND token_hash = ? AND expires_at > ?`
        )
        .run(revocationTime, this.namespace, tokenHash, this.#recordNow());
    });
  }

  async revokeGrant(grantId: string, now: number): Promise<void> {
    assertNonEmpty(grantId, "Authorization grant ID");
    const revocationTime = safeTimestamp(now, "Authorization grant revocation time");
    this.#transaction(() => this.#revokeGrantRows(grantId, revocationTime));
  }

  async loadCredential(subject: string): Promise<LoadedSQLiteSkylightCredential | null> {
    return this.#loadCredential(subject);
  }

  async saveCredential(
    subject: string,
    value: string | StoredOAuthCredential,
    version?: number
  ): Promise<SQLiteCredentialSaveResult> {
    this.#assertSubject(subject);
    const authorization = typeof value === "string" ? value : serializeOAuthCredential(value);
    if (parseOAuthCredential(authorization) === null) {
      throw new Error("Only a serialized Skylight OAuth credential can be stored in SQLite.");
    }
    const explicitExpected =
      version === undefined ? undefined : expectedVersion(version, "Expected credential version");
    return this.#transaction(() => {
      const currentVersion = this.#credentialVersion(subject);
      if (explicitExpected !== undefined && currentVersion !== explicitExpected) {
        return { saved: false, currentVersion };
      }
      const nextVersion = currentVersion + 1;
      const updatedAt = this.#recordNow();
      const encrypted = this.#encryptCredential(
        subject,
        authorization,
        nextVersion,
        updatedAt
      );
      this.#writeCredential(subject, encrypted);
      return { saved: true, version: nextVersion, updatedAt };
    });
  }

  async deleteCredential(subject: string, version?: number): Promise<boolean> {
    this.#assertSubject(subject);
    const explicitExpected =
      version === undefined ? undefined : expectedVersion(version, "Expected credential version");
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT credential_version
             FROM sk_oauth_credentials
            WHERE namespace = ? AND subject = ?`
        )
        .get(this.namespace, subject);
      if (row === undefined) return false;
      const currentVersion = requiredInteger(row, "credential_version", "credential version");
      if (explicitExpected !== undefined && explicitExpected !== currentVersion) return false;
      const result = this.#database
        .prepare("DELETE FROM sk_oauth_credentials WHERE namespace = ? AND subject = ?")
        .run(this.namespace, subject);
      return Number(result.changes) === 1;
    });
  }

  async acquireCredentialRefreshLease(
    subject: string,
    owner: string,
    ttlMs: number
  ): Promise<boolean> {
    this.#assertSubject(subject);
    assertNonEmpty(owner, "Credential refresh lease owner");
    const ttl = positiveInteger(ttlMs, "Credential refresh lease TTL");
    return this.#acquireCredentialLease(subject, owner, ttl);
  }

  async releaseCredentialRefreshLease(subject: string, owner: string): Promise<boolean> {
    this.#assertSubject(subject);
    assertNonEmpty(owner, "Credential refresh lease owner");
    this.#assertOpen();
    const result = this.#database
      .prepare(
        `DELETE FROM sk_oauth_credential_leases
          WHERE namespace = ? AND subject = ? AND owner = ?`
      )
      .run(this.namespace, subject, owner);
    return Number(result.changes) === 1;
  }

  /**
   * Quick readiness probe. BEGIN IMMEDIATE verifies local write availability;
   * the metadata read verifies the configured namespace without mutating state.
   */
  async healthCheck(): Promise<void> {
    this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT 1 AS healthy
             FROM sk_oauth_store_metadata
            WHERE namespace = ?`
        )
        .get(this.namespace);
      if (row === undefined || requiredInteger(row, "healthy", "health probe") !== 1) {
        throw new Error("Hosted OAuth SQLite namespace metadata is unavailable.");
      }
    });
  }

  /** Idempotently checkpoint and close the local database. */
  close(): void {
    if (this.#closed) return;
    if (this.#activeCredentialUpdates !== 0) {
      throw new Error("Cannot close SQLite OAuth storage during a credential update.");
    }
    this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.#secureDatabaseFiles();
    this.#database.close();
    this.#closed = true;
  }

  #initializeSchema(): void {
    this.#transaction(() => {
      const versionRow = this.#database.prepare("PRAGMA user_version").get();
      const version = requiredInteger(versionRow ?? {}, "user_version", "schema version");
      if (version !== 0 && version !== SCHEMA_VERSION) {
        throw new Error(
          `Hosted OAuth SQLite database has unsupported schema version ${version}; expected ${SCHEMA_VERSION}.`
        );
      }
      const applicationRow = this.#database.prepare("PRAGMA application_id").get();
      const applicationId = requiredInteger(
        applicationRow ?? {},
        "application_id",
        "application ID"
      );
      if (version === 0) {
        if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
          throw new Error("SQLite database belongs to a different application.");
        }
        this.#database.exec(SCHEMA);
        this.#database.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
        this.#database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        return;
      }
      if (applicationId !== APPLICATION_ID) {
        throw new Error("Hosted OAuth SQLite database has an invalid application ID.");
      }
    });
  }

  #initializeNamespaceMetadata(): void {
    const subjectKeyFingerprint = digest(this.#subjectKey);
    this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT signing_key_id, subject_key_fingerprint
             FROM sk_oauth_store_metadata
            WHERE namespace = ?`
        )
        .get(this.namespace);
      if (row === undefined) {
        this.#database
          .prepare(
            `INSERT INTO sk_oauth_store_metadata
               (namespace, signing_key_id, subject_key_fingerprint, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run(
            this.namespace,
            this.#signingKey.keyId,
            subjectKeyFingerprint,
            this.#recordNow()
          );
        return;
      }
      if (
        requiredString(row, "signing_key_id", "stored signing key ID") !==
        this.#signingKey.keyId
      ) {
        throw new Error(
          `Hosted OAuth signing key does not match SQLite namespace ${this.namespace}.`
        );
      }
      if (
        requiredString(row, "subject_key_fingerprint", "stored subject key fingerprint") !==
        subjectKeyFingerprint
      ) {
        throw new Error(
          `Hosted OAuth subject key does not match SQLite namespace ${this.namespace}.`
        );
      }
    });
  }

  #transaction<T>(operation: () => T): T {
    this.#assertOpen();
    if (this.#database.isTransaction) {
      throw new Error("Nested SQLite OAuth transactions are not supported.");
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.#database.exec("COMMIT");
      return value;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #grantFromRow(row: Readonly<Record<string, unknown>>): AuthorizationGrantRecord {
    const record = recordFromRow<AuthorizationGrantRecord>(row, "authorization grant");
    const revokedAt = optionalInteger(row, "revoked_at", "authorization grant revocation");
    return revokedAt === undefined ? record : { ...record, revokedAt };
  }

  #accessTokenFromRow(row: Readonly<Record<string, unknown>>): AccessTokenRecord {
    const record = recordFromRow<AccessTokenRecord>(row, "access token");
    const revokedAt = optionalInteger(row, "revoked_at", "access token revocation");
    return revokedAt === undefined ? record : { ...record, revokedAt };
  }

  #refreshTokenFromRow(row: Readonly<Record<string, unknown>>): RefreshTokenRecord {
    const record = recordFromRow<RefreshTokenRecord>(row, "refresh token");
    const status = requiredString(row, "status", "refresh token status");
    if (status !== "active" && status !== "rotated" && status !== "revoked") {
      throw new Error("SQLite contained an invalid refresh token status.");
    }
    return { ...record, status };
  }

  #revokeGrantRows(grantId: string, now: number): void {
    this.#database
      .prepare(
        `UPDATE sk_oauth_grants
            SET revoked_at = COALESCE(revoked_at, ?),
                expires_at = MAX(expires_at, ?)
          WHERE namespace = ? AND grant_id = ?`
      )
      .run(
        now,
        this.#retentionDeadline(now, this.#grantRetentionMs),
        this.namespace,
        grantId
      );
    this.#database
      .prepare(
        `UPDATE sk_oauth_access_tokens
            SET revoked_at = COALESCE(revoked_at, ?)
          WHERE namespace = ? AND grant_id = ?`
      )
      .run(now, this.namespace, grantId);
    this.#database
      .prepare(
        `UPDATE sk_oauth_refresh_tokens
            SET status = 'revoked'
          WHERE namespace = ? AND grant_id = ?`
      )
      .run(this.namespace, grantId);
  }

  #touchGrant(grantId: string, activityExpiresAt: number): void {
    const deadline = this.#retentionDeadline(
      Math.max(this.#recordNow(), activityExpiresAt),
      this.#grantRetentionMs
    );
    this.#database
      .prepare(
        `UPDATE sk_oauth_grants
            SET expires_at = MAX(expires_at, ?)
          WHERE namespace = ? AND grant_id = ?`
      )
      .run(deadline, this.namespace, grantId);
  }

  #loadCredential(subject: string): LoadedSQLiteSkylightCredential | null {
    this.#assertSubject(subject);
    this.#assertOpen();
    const row = this.#database
      .prepare(
        `SELECT credential_version, updated_at, key_id, iv, ciphertext, tag
           FROM sk_oauth_credentials
          WHERE namespace = ? AND subject = ?`
      )
      .get(this.namespace, subject);
    if (row === undefined) return null;
    const encrypted = this.#encryptedCredentialFromRow(row);
    const key = this.#decryptionKeys.get(encrypted.keyId);
    if (key === undefined) {
      throw new Error(
        `No decryption key is configured for credential key ID ${encrypted.keyId}.`
      );
    }
    const authorization = this.#decryptCredential(subject, encrypted, key);
    const credential = parseOAuthCredential(authorization);
    if (credential === null) {
      throw new Error("The decrypted SQLite Skylight credential is invalid.");
    }
    return {
      authorization,
      credential,
      version: encrypted.credentialVersion,
      updatedAt: encrypted.updatedAt,
    };
  }

  #credentialVersion(subject: string): number {
    const row = this.#database
      .prepare(
        `SELECT credential_version
           FROM sk_oauth_credentials
          WHERE namespace = ? AND subject = ?`
      )
      .get(this.namespace, subject);
    return row === undefined
      ? 0
      : requiredInteger(row, "credential_version", "credential version");
  }

  #encryptedCredentialFromRow(
    row: Readonly<Record<string, unknown>>
  ): EncryptedCredentialRow {
    const credentialVersion = requiredInteger(
      row,
      "credential_version",
      "credential version"
    );
    const updatedAt = requiredInteger(row, "updated_at", "credential update time");
    const keyId = requiredString(row, "key_id", "credential key ID");
    const iv = requiredBytes(row, "iv", "credential IV");
    const ciphertext = requiredBytes(row, "ciphertext", "credential ciphertext");
    const tag = requiredBytes(row, "tag", "credential authentication tag");
    if (
      credentialVersion < 1 ||
      updatedAt < 0 ||
      iv.length !== 12 ||
      ciphertext.length === 0 ||
      tag.length !== 16
    ) {
      throw new Error("SQLite contained an invalid encrypted Skylight credential.");
    }
    assertKeyId(keyId);
    return { credentialVersion, updatedAt, keyId, iv, ciphertext, tag };
  }

  #credentialAad(
    subject: string,
    version: number,
    updatedAt: number,
    keyId: string
  ): Buffer {
    return Buffer.from(
      JSON.stringify([
        "skylight-calendar-agent/sqlite-credential",
        this.namespace,
        subject,
        version,
        updatedAt,
        keyId,
      ]),
      "utf8"
    );
  }

  #encryptCredential(
    subject: string,
    authorization: string,
    version: number,
    updatedAt: number
  ): EncryptedCredentialRow {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#currentKey, iv);
    cipher.setAAD(this.#credentialAad(subject, version, updatedAt, this.encryptionKeyId));
    const ciphertext = Buffer.concat([
      cipher.update(authorization, "utf8"),
      cipher.final(),
    ]);
    return {
      credentialVersion: version,
      updatedAt,
      keyId: this.encryptionKeyId,
      iv,
      ciphertext,
      tag: cipher.getAuthTag(),
    };
  }

  #decryptCredential(
    subject: string,
    encrypted: EncryptedCredentialRow,
    key: Buffer
  ): string {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
      decipher.setAAD(
        this.#credentialAad(
          subject,
          encrypted.credentialVersion,
          encrypted.updatedAt,
          encrypted.keyId
        )
      );
      decipher.setAuthTag(encrypted.tag);
      return Buffer.concat([
        decipher.update(encrypted.ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error(
        "The encrypted SQLite Skylight credential could not be authenticated or decrypted."
      );
    }
  }

  #writeCredential(subject: string, encrypted: EncryptedCredentialRow): void {
    this.#database
      .prepare(
        `INSERT INTO sk_oauth_credentials
           (namespace, subject, credential_version, updated_at, key_id, iv, ciphertext, tag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (namespace, subject) DO UPDATE SET
           credential_version = excluded.credential_version,
           updated_at = excluded.updated_at,
           key_id = excluded.key_id,
           iv = excluded.iv,
           ciphertext = excluded.ciphertext,
           tag = excluded.tag`
      )
      .run(
        this.namespace,
        subject,
        encrypted.credentialVersion,
        encrypted.updatedAt,
        encrypted.keyId,
        encrypted.iv,
        encrypted.ciphertext,
        encrypted.tag
      );
  }

  async #setHostedCredential(
    subject: string,
    credential: StoredOAuthCredential
  ): Promise<void> {
    await this.#withCredentialUpdateLease(subject, async (owner) => {
      const currentVersion = this.#credentialVersion(subject);
      const normalized = this.#normalizedCredential(credential);
      this.#saveCredentialWithLease(
        subject,
        normalized.authorization,
        currentVersion,
        owner
      );
    });
  }

  async #deleteHostedCredential(subject: string): Promise<void> {
    await this.#withCredentialUpdateLease(subject, async (owner) => {
      const currentVersion = this.#credentialVersion(subject);
      this.#transaction(() => {
        this.#assertCredentialLease(subject, owner);
        const foundVersion = this.#credentialVersion(subject);
        if (foundVersion !== currentVersion) {
          throw new Error(
            `Hosted OAuth credential changed outside its coordinated update (expected version ${currentVersion}, found ${foundVersion}).`
          );
        }
        this.#database
          .prepare("DELETE FROM sk_oauth_credentials WHERE namespace = ? AND subject = ?")
          .run(this.namespace, subject);
      });
    });
  }

  async #updateHostedCredential(
    subject: string,
    update: (
      credential: StoredOAuthCredential
    ) => Promise<StoredOAuthCredential> | StoredOAuthCredential
  ): Promise<StoredOAuthCredential> {
    return this.#withCredentialUpdateLease(subject, async (owner) => {
      const current = this.#loadCredential(subject);
      if (current === null) {
        throw new Error("Provider credential is missing; reconnect required.");
      }
      const replacement = this.#normalizedCredential(await update(current.credential));
      this.#saveCredentialWithLease(
        subject,
        replacement.authorization,
        current.version,
        owner
      );
      return replacement.credential;
    });
  }

  #normalizedCredential(credential: StoredOAuthCredential): {
    authorization: string;
    credential: StoredOAuthCredential;
  } {
    const authorization = serializeOAuthCredential(credential);
    const normalized = parseOAuthCredential(authorization);
    if (normalized === null) {
      throw new Error("Only a valid Skylight OAuth credential can be stored in SQLite.");
    }
    return { authorization, credential: normalized };
  }

  #saveCredentialWithLease(
    subject: string,
    authorization: string,
    version: number,
    owner: string
  ): void {
    const expected = expectedVersion(version, "Expected credential version");
    this.#transaction(() => {
      this.#assertCredentialLease(subject, owner);
      const currentVersion = this.#credentialVersion(subject);
      if (currentVersion !== expected) {
        throw new Error(
          `Hosted OAuth credential changed outside its coordinated update (expected version ${expected}, found ${currentVersion}).`
        );
      }
      const nextVersion = expected + 1;
      const updatedAt = this.#recordNow();
      this.#writeCredential(
        subject,
        this.#encryptCredential(subject, authorization, nextVersion, updatedAt)
      );
    });
  }

  async #withCredentialUpdateLease<T>(
    subject: string,
    operation: (owner: string) => Promise<T>
  ): Promise<T> {
    this.#assertSubject(subject);
    this.#assertOpen();
    this.#activeCredentialUpdates += 1;
    const owner = randomBytes(24).toString("base64url");
    let acquired = false;
    let timer: NodeJS.Timeout | undefined;
    try {
      await this.#waitForCredentialUpdateLease(subject, owner);
      acquired = true;
      timer = setInterval(() => {
        try {
          this.#renewCredentialLease(subject, owner);
        } catch {
          // The owner/version fence on commit is authoritative.
        }
      }, Math.floor(CREDENTIAL_UPDATE_LEASE_TTL_MS / 3));
      timer.unref();
      return await operation(owner);
    } finally {
      if (timer !== undefined) clearInterval(timer);
      if (acquired && !this.#closed) {
        try {
          await this.releaseCredentialRefreshLease(subject, owner);
        } catch {
          // An expired owner-checked lease is safe to leave for cleanup.
        }
      }
      this.#activeCredentialUpdates -= 1;
    }
  }

  async #waitForCredentialUpdateLease(subject: string, owner: string): Promise<void> {
    const deadline = Date.now() + CREDENTIAL_UPDATE_WAIT_TIMEOUT_MS;
    let retryMs = CREDENTIAL_UPDATE_RETRY_MIN_MS;
    while (!this.#acquireCredentialLease(subject, owner, CREDENTIAL_UPDATE_LEASE_TTL_MS)) {
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the hosted OAuth credential update lease.");
      }
      await wait(retryMs);
      retryMs = Math.min(CREDENTIAL_UPDATE_RETRY_MAX_MS, retryMs * 2);
    }
  }

  #acquireCredentialLease(subject: string, owner: string, ttlMs: number): boolean {
    return this.#transaction(() => {
      const now = this.#recordNow();
      this.#database
        .prepare(
          `DELETE FROM sk_oauth_credential_leases
            WHERE namespace = ? AND subject = ? AND expires_at <= ?`
        )
        .run(this.namespace, subject, now);
      const result = this.#database
        .prepare(
          `INSERT OR IGNORE INTO sk_oauth_credential_leases
             (namespace, subject, owner, expires_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(this.namespace, subject, owner, now + ttlMs);
      return Number(result.changes) === 1;
    });
  }

  #renewCredentialLease(subject: string, owner: string): boolean {
    this.#assertOpen();
    const now = this.#recordNow();
    const result = this.#database
      .prepare(
        `UPDATE sk_oauth_credential_leases
            SET expires_at = ?
          WHERE namespace = ? AND subject = ? AND owner = ? AND expires_at > ?`
      )
      .run(
        now + CREDENTIAL_UPDATE_LEASE_TTL_MS,
        this.namespace,
        subject,
        owner,
        now
      );
    return Number(result.changes) === 1;
  }

  #assertCredentialLease(subject: string, owner: string): void {
    const row = this.#database
      .prepare(
        `SELECT owner, expires_at
           FROM sk_oauth_credential_leases
          WHERE namespace = ? AND subject = ?`
      )
      .get(this.namespace, subject);
    if (
      row === undefined ||
      requiredString(row, "owner", "credential lease owner") !== owner ||
      requiredInteger(row, "expires_at", "credential lease expiration") <= this.#recordNow()
    ) {
      throw new Error("Hosted OAuth credential update lease was lost before persistence.");
    }
  }

  #recordNow(): number {
    return safeTimestamp(Math.floor(this.#now()), "Current time");
  }

  #retentionDeadline(base: number, retentionMs: number): number {
    const deadline = base + retentionMs;
    if (!Number.isSafeInteger(deadline)) {
      throw new Error("OAuth retention deadline exceeds SQLite's safe timestamp range.");
    }
    return deadline;
  }

  #assertSubject(subject: string): void {
    assertNonEmpty(subject, "OAuth subject");
    if (subject !== subject.trim()) {
      throw new Error("OAuth subject must not have surrounding whitespace.");
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("SQLite OAuth storage is closed.");
  }

  #secureDatabaseFiles(): void {
    if (process.platform === "win32") return;
    for (const file of [this.databasePath, `${this.databasePath}-wal`, `${this.databasePath}-shm`]) {
      try {
        chmodSync(file, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}
