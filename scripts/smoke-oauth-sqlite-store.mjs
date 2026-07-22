import assert from "node:assert/strict";
import {
  createHmac,
  createPrivateKey,
  generateKeyPairSync,
} from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SQLiteSkylightOAuthStore } from "../dist/skylight/oauth-sqlite-store.js";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const directory = await mkdtemp(path.join(tmpdir(), "skylight-oauth-sqlite-"));
const databasePath = path.join(directory, "hosted-oauth.sqlite");
const encryptionKey = Buffer.alloc(32, 0x5a);
const subjectKey = Buffer.alloc(32, 0x6b);
const signingKeyPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const signingPrivateKey = signingKeyPair.privateKey;
let now = 1_800_000_000_000;

const options = () => ({
  databasePath,
  encryptionKey,
  signingPrivateKey,
  subjectKey,
  encryptionKeyId: "smoke-key-v1",
  namespace: "skylight-smoke",
  busyTimeoutMs: 250,
  now: () => now,
});

let store;
let peer;
try {
  assert.throws(
    () => new SQLiteSkylightOAuthStore({ ...options(), databasePath: ":memory:" }),
    /persistent SQLite database file/
  );
  assert.throws(
    () =>
      new SQLiteSkylightOAuthStore({
        ...options(),
        databasePath: path.join(directory, "bad-key.sqlite"),
        encryptionKey: Buffer.alloc(31),
      }),
    /Credential encryption key must contain exactly 32 bytes/
  );
  assert.throws(
    () =>
      new SQLiteSkylightOAuthStore({
        ...options(),
        databasePath: path.join(directory, "same-key.sqlite"),
        subjectKey: encryptionKey,
      }),
    /must be distinct/
  );
  assert.throws(
    () =>
      new SQLiteSkylightOAuthStore({
        ...options(),
        databasePath: path.join(directory, "public-key.sqlite"),
        signingPrivateKey: signingKeyPair.publicKey,
      }),
    /must be a P-256 EC private key/
  );

  const incompatiblePath = path.join(directory, "incompatible.sqlite");
  const incompatible = new DatabaseSync(incompatiblePath);
  incompatible.exec("PRAGMA user_version = 999");
  incompatible.close();
  assert.throws(
    () =>
      new SQLiteSkylightOAuthStore({
        ...options(),
        databasePath: incompatiblePath,
      }),
    /schema version 999/
  );

  store = new SQLiteSkylightOAuthStore(options());
  peer = new SQLiteSkylightOAuthStore({
    ...options(),
    signingPrivateKey: createPrivateKey({
      key: signingPrivateKey.export({ format: "der", type: "pkcs8" }),
      format: "der",
      type: "pkcs8",
    }),
  });

  assert.equal(store.authorizationServer, store);
  assert.deepEqual(store.capabilities, {
    durable: true,
    encryptedCredentials: true,
    stableKeys: true,
    shared: false,
  });
  assert.equal(store.databasePath, databasePath);
  await store.healthCheck();

  const probe = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(probe.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(probe.prepare("PRAGMA user_version").get().user_version, 1);
  assert.ok(
    Number(
      probe
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'sk_oauth_%'")
        .get().count
    ) >= 8
  );
  probe.close();

  const [firstSigningKey, restartedSigningKey] = await Promise.all([
    store.signingKey(),
    peer.signingKey(),
  ]);
  assert.equal(firstSigningKey.algorithm, "ES256");
  assert.equal(firstSigningKey.keyId, restartedSigningKey.keyId);
  assert.deepEqual(firstSigningKey.publicJwk, restartedSigningKey.publicJwk);

  const expectedSubject = createHmac("sha256", subjectKey)
    .update("Skylight")
    .update("\0")
    .update("account-1")
    .digest("base64url");
  assert.equal(await store.resolveSubject("Skylight", "account-1"), expectedSubject);
  assert.equal(await peer.resolveSubject("Skylight", "account-1"), expectedSubject);
  assert.notEqual(await store.resolveSubject("Skylight", "account-2"), expectedSubject);
  await assert.rejects(
    store.resolveSubject("skylight", "account-1"),
    /must remain exactly "Skylight"/
  );
  await assert.rejects(
    store.resolveSubject("Skylight", " account-1"),
    /surrounding whitespace/
  );

  assert.throws(
    () =>
      new SQLiteSkylightOAuthStore({
        ...options(),
        subjectKey: Buffer.alloc(32, 0x7c),
      }),
    /subject key does not match/
  );
  assert.throws(
    () =>
      new SQLiteSkylightOAuthStore({
        ...options(),
        signingPrivateKey: generateKeyPairSync("ec", { namedCurve: "P-256" })
          .privateKey,
      }),
    /signing key does not match/
  );

  await store.putClient({
    id: "client-1",
    redirectUris: ["https://example.test/callback"],
    createdAt: now,
  });
  assert.equal((await peer.getClient("client-1"))?.id, "client-1");

  const transaction = {
    id: "transaction-1",
    clientId: "client-1",
    redirectUri: "https://example.test/callback",
    codeChallenge: "challenge",
    resource: "https://calendar.example.test/",
    scopes: ["mcp", "offline_access"],
    state: "state-1",
    createdAt: now,
    expiresAt: now + 10_000,
  };
  await store.putAuthorizationTransaction(transaction);
  assert.equal(
    (await peer.getAuthorizationTransaction(transaction.id))?.state,
    "state-1"
  );
  const transactionTakes = await Promise.all([
    store.takeAuthorizationTransaction(transaction.id),
    peer.takeAuthorizationTransaction(transaction.id),
  ]);
  assert.equal(transactionTakes.filter((value) => value !== undefined).length, 1);

  const hostedInteraction = {
    ...transaction,
    id: "hosted-interaction-1",
    state: "hosted-state",
  };
  await store.interactions.set(hostedInteraction);
  assert.equal(
    (await peer.interactions.get(hostedInteraction.id))?.state,
    "hosted-state"
  );
  await peer.interactions.delete(hostedInteraction.id);
  assert.equal(await store.interactions.get(hostedInteraction.id), undefined);

  const grant = {
    id: "grant-1",
    clientId: "client-1",
    subject: "account-1",
    resource: "https://calendar.example.test/",
    scopes: ["mcp", "offline_access"],
    createdAt: now,
  };
  await store.putGrant(grant);

  const code = {
    tokenHash: "code-hash-1",
    grantId: grant.id,
    clientId: grant.clientId,
    subject: grant.subject,
    redirectUri: "https://example.test/callback",
    codeChallenge: "challenge",
    resource: grant.resource,
    scopes: grant.scopes,
    expiresAt: now + 10_000,
  };
  await store.putAuthorizationCode(code);
  const codeTakes = await Promise.all([
    store.takeAuthorizationCode(code.tokenHash),
    peer.takeAuthorizationCode(code.tokenHash),
  ]);
  assert.equal(codeTakes.filter((value) => value !== undefined).length, 1);

  await store.putAccessToken({
    tokenHash: "access-hash-1",
    tokenId: "access-id-1",
    grantId: grant.id,
    subject: grant.subject,
    clientId: grant.clientId,
    resource: grant.resource,
    expiresAt: now + 20_000,
  });
  await peer.revokeToken("access-hash-1", now + 10);
  assert.equal((await store.getAccessToken("access-hash-1"))?.revokedAt, now + 10);

  await store.putAccessToken({
    tokenHash: "family-access",
    tokenId: "family-access-id",
    grantId: grant.id,
    subject: grant.subject,
    clientId: grant.clientId,
    resource: grant.resource,
    expiresAt: now + 40_000,
  });
  const refresh = {
    tokenHash: "refresh-hash-1",
    familyId: "family-1",
    grantId: grant.id,
    clientId: grant.clientId,
    subject: grant.subject,
    resource: grant.resource,
    scopes: grant.scopes,
    createdAt: now,
    expiresAt: now + 30_000,
    status: "active",
  };
  await store.putRefreshToken(refresh);
  const rotations = await Promise.all([
    store.rotateRefreshToken(
      refresh.tokenHash,
      "refresh-hash-2",
      now + 20,
      now + 40_000
    ),
    peer.rotateRefreshToken(
      refresh.tokenHash,
      "refresh-hash-3",
      now + 30,
      now + 40_000
    ),
  ]);
  assert.deepEqual(
    rotations.map((result) => result.status).sort(),
    ["replay", "rotated"]
  );
  assert.equal((await store.getRefreshToken(refresh.tokenHash))?.status, "revoked");
  assert.equal((await store.getRefreshToken("refresh-hash-2"))?.status, "revoked");
  assert.equal(await store.getRefreshToken("refresh-hash-3"), undefined);
  assert.equal((await store.getGrant(grant.id))?.revokedAt, now + 30);
  assert.equal((await store.getAccessToken("family-access"))?.revokedAt, now + 30);

  const refreshRevocationGrant = { ...grant, id: "grant-refresh-revocation" };
  await store.putGrant(refreshRevocationGrant);
  await store.putAccessToken({
    tokenHash: "refresh-revocation-access",
    tokenId: "refresh-revocation-access-id",
    grantId: refreshRevocationGrant.id,
    subject: refreshRevocationGrant.subject,
    clientId: refreshRevocationGrant.clientId,
    resource: refreshRevocationGrant.resource,
    expiresAt: now + 20_000,
  });
  await store.putRefreshToken({
    ...refresh,
    tokenHash: "refresh-to-revoke",
    familyId: "family-to-revoke",
    grantId: refreshRevocationGrant.id,
  });
  await peer.revokeToken("refresh-to-revoke", now + 35);
  assert.equal(
    (await store.getGrant(refreshRevocationGrant.id))?.revokedAt,
    now + 35
  );
  assert.equal(
    (await store.getAccessToken("refresh-revocation-access"))?.revokedAt,
    now + 35
  );
  assert.equal((await store.getRefreshToken("refresh-to-revoke"))?.status, "revoked");

  const cascadingGrant = { ...grant, id: "grant-cascade" };
  await store.putGrant(cascadingGrant);
  await store.putAccessToken({
    tokenHash: "cascade-access",
    tokenId: "cascade-access-id",
    grantId: cascadingGrant.id,
    subject: cascadingGrant.subject,
    clientId: cascadingGrant.clientId,
    resource: cascadingGrant.resource,
    expiresAt: now + 20_000,
  });
  await store.putRefreshToken({
    ...refresh,
    tokenHash: "cascade-refresh",
    familyId: "cascade-family",
    grantId: cascadingGrant.id,
  });
  await peer.revokeGrant(cascadingGrant.id, now + 40);
  assert.equal((await store.getGrant(cascadingGrant.id))?.revokedAt, now + 40);
  assert.equal((await store.getAccessToken("cascade-access"))?.revokedAt, now + 40);
  assert.equal((await store.getRefreshToken("cascade-refresh"))?.status, "revoked");

  const collisionGrant = { ...grant, id: "grant-rotation-collision" };
  await store.putGrant(collisionGrant);
  await store.putRefreshToken({
    ...refresh,
    tokenHash: "collision-old",
    familyId: "collision-family",
    grantId: collisionGrant.id,
  });
  await store.putRefreshToken({
    ...refresh,
    tokenHash: "collision-replacement",
    familyId: "other-family",
    grantId: collisionGrant.id,
  });
  assert.deepEqual(
    await peer.rotateRefreshToken(
      "collision-old",
      "collision-replacement",
      now + 45,
      now + 40_000
    ),
    { status: "invalid" }
  );
  assert.equal((await store.getRefreshToken("collision-old"))?.status, "active");

  const expiringGrant = { ...grant, id: "grant-expiry" };
  await store.putGrant(expiringGrant);
  await store.putAuthorizationTransaction({
    ...transaction,
    id: "transaction-expiry",
    expiresAt: now + 5,
  });
  await store.putAuthorizationCode({
    ...code,
    tokenHash: "code-expiry",
    grantId: expiringGrant.id,
    expiresAt: now + 5,
  });
  await store.putAccessToken({
    tokenHash: "access-expiry",
    tokenId: "access-expiry-id",
    grantId: expiringGrant.id,
    subject: expiringGrant.subject,
    clientId: expiringGrant.clientId,
    resource: expiringGrant.resource,
    expiresAt: now + 5,
  });
  await store.putRefreshToken({
    ...refresh,
    tokenHash: "refresh-expiry",
    familyId: "family-expiry",
    grantId: expiringGrant.id,
    expiresAt: now + 5,
  });
  now += 6;
  await peer.cleanup();
  assert.equal(await store.getAuthorizationTransaction("transaction-expiry"), undefined);
  assert.equal(await store.takeAuthorizationCode("code-expiry"), undefined);
  assert.equal(await store.getAccessToken("access-expiry"), undefined);
  assert.equal(await store.getRefreshToken("refresh-expiry"), undefined);
  assert.equal((await store.getRefreshToken(refresh.tokenHash))?.status, "revoked");

  const credentialV1 = {
    version: 1,
    type: "oauth",
    accessToken: "plaintext-access-secret-never-store-this",
    refreshToken: "plaintext-refresh-secret-never-store-this",
    fingerprint: "fingerprint-v1",
    expiresAt: now + 60_000,
  };
  const firstSave = await store.saveCredential("subject-a", credentialV1, 0);
  assert.deepEqual(
    { saved: firstSave.saved, version: firstSave.saved ? firstSave.version : null },
    { saved: true, version: 1 }
  );
  assert.deepEqual((await peer.loadCredential("subject-a"))?.credential, credentialV1);
  assert.deepEqual(await store.saveCredential("subject-a", credentialV1, 0), {
    saved: false,
    currentVersion: 1,
  });

  const inspector = new DatabaseSync(databasePath);
  const encryptedRow = inspector
    .prepare(
      `SELECT iv, ciphertext, tag
         FROM sk_oauth_credentials
        WHERE namespace = ? AND subject = ?`
    )
    .get("skylight-smoke", "subject-a");
  assert.ok(encryptedRow);
  const encryptedBytes = Buffer.concat([
    Buffer.from(encryptedRow.iv),
    Buffer.from(encryptedRow.ciphertext),
    Buffer.from(encryptedRow.tag),
  ]).toString("utf8");
  assert.equal(encryptedBytes.includes(credentialV1.accessToken), false);
  assert.equal(encryptedBytes.includes(credentialV1.refreshToken), false);

  inspector
    .prepare(
      `INSERT INTO sk_oauth_credentials
         (namespace, subject, credential_version, updated_at, key_id, iv, ciphertext, tag)
       SELECT namespace, ?, credential_version, updated_at, key_id, iv, ciphertext, tag
         FROM sk_oauth_credentials
        WHERE namespace = ? AND subject = ?`
    )
    .run("subject-b", "skylight-smoke", "subject-a");
  await assert.rejects(
    store.loadCredential("subject-b"),
    /could not be authenticated or decrypted/
  );
  inspector
    .prepare("DELETE FROM sk_oauth_credentials WHERE namespace = ? AND subject = ?")
    .run("skylight-smoke", "subject-b");
  inspector.close();

  const credentialV2 = {
    ...credentialV1,
    accessToken: "access-v2",
    refreshToken: "refresh-v2",
    fingerprint: "fingerprint-v2",
  };
  const secondSave = await peer.saveCredential("subject-a", credentialV2, 1);
  assert.equal(secondSave.saved && secondSave.version, 2);
  assert.equal((await store.loadCredential("subject-a"))?.version, 2);
  assert.equal(await store.deleteCredential("subject-a", 1), false);
  assert.equal(await store.deleteCredential("subject-a", 2), true);
  assert.equal(await store.loadCredential("subject-a"), null);

  assert.equal(
    await store.acquireCredentialRefreshLease("lease-subject", "worker-1", 5_000),
    true
  );
  assert.equal(
    await peer.acquireCredentialRefreshLease("lease-subject", "worker-2", 5_000),
    false
  );
  assert.equal(
    await peer.releaseCredentialRefreshLease("lease-subject", "worker-2"),
    false
  );
  assert.equal(
    await store.releaseCredentialRefreshLease("lease-subject", "worker-1"),
    true
  );

  await store.credentials.set("hosted-subject", credentialV1);
  await store.credentials.set("second-hosted-subject", {
    ...credentialV1,
    accessToken: "second-subject-access",
    refreshToken: "second-subject-refresh",
  });
  assert.deepEqual(await peer.credentials.get("hosted-subject"), credentialV1);

  let firstUpdateStartedResolve;
  const firstUpdateStarted = new Promise((resolve) => {
    firstUpdateStartedResolve = resolve;
  });
  let releaseFirstUpdate;
  const firstUpdateGate = new Promise((resolve) => {
    releaseFirstUpdate = resolve;
  });
  const updateOrder = [];
  const firstUpdate = store.credentials.update("hosted-subject", async (current) => {
    updateOrder.push(`first:${current.accessToken}`);
    firstUpdateStartedResolve();
    await firstUpdateGate;
    return {
      ...current,
      accessToken: "hosted-access-v2",
      refreshToken: "hosted-refresh-v2",
    };
  });
  await firstUpdateStarted;
  let secondUpdateCalls = 0;
  const secondUpdate = peer.credentials.update("hosted-subject", async (current) => {
    secondUpdateCalls += 1;
    updateOrder.push(`second:${current.accessToken}`);
    return {
      ...current,
      accessToken: "hosted-access-v3",
      refreshToken: "hosted-refresh-v3",
    };
  });
  await delay(25);
  assert.equal(
    secondUpdateCalls,
    0,
    "cross-connection update callback ran without the durable SQLite lease"
  );
  releaseFirstUpdate();
  const [firstUpdatedCredential, secondUpdatedCredential] = await Promise.all([
    firstUpdate,
    secondUpdate,
  ]);
  assert.equal(firstUpdatedCredential.accessToken, "hosted-access-v2");
  assert.equal(secondUpdatedCredential.accessToken, "hosted-access-v3");
  assert.deepEqual(updateOrder, [
    `first:${credentialV1.accessToken}`,
    "second:hosted-access-v2",
  ]);
  assert.equal(
    (await store.credentials.get("hosted-subject"))?.refreshToken,
    "hosted-refresh-v3"
  );
  assert.equal(
    (await store.credentials.get("second-hosted-subject"))?.accessToken,
    "second-subject-access"
  );

  await assert.rejects(
    store.credentials.update("hosted-subject", async () => {
      throw new Error("intentional update failure");
    }),
    /intentional update failure/
  );
  const afterFailedUpdate = await peer.credentials.update(
    "hosted-subject",
    (current) => ({ ...current, fingerprint: "after-failure" })
  );
  assert.equal(afterFailedUpdate.fingerprint, "after-failure");

  await store.credentials.set("lease-fencing-subject", credentialV1);
  await assert.rejects(
    store.credentials.update("lease-fencing-subject", (current) => {
      now += 60_001;
      return { ...current, accessToken: "must-not-be-persisted" };
    }),
    /lease was lost/
  );
  assert.equal(
    (await peer.credentials.get("lease-fencing-subject"))?.accessToken,
    credentialV1.accessToken
  );
  await peer.credentials.delete("lease-fencing-subject");
  await assert.rejects(
    store.credentials.update("missing-hosted-subject", (current) => current),
    /missing; reconnect required/
  );

  // A short busy timeout bounds lock contention and leaves the store usable.
  const busyPath = path.join(directory, "busy.sqlite");
  const busyStore = new SQLiteSkylightOAuthStore({
    ...options(),
    databasePath: busyPath,
    namespace: "busy-smoke",
    busyTimeoutMs: 25,
  });
  const blocker = new DatabaseSync(busyPath);
  blocker.exec("BEGIN IMMEDIATE");
  await assert.rejects(
    busyStore.putClient({ id: "blocked", redirectUris: [], createdAt: now }),
    /locked|busy/i
  );
  blocker.exec("ROLLBACK");
  blocker.close();
  await busyStore.putClient({ id: "after-lock", redirectUris: [], createdAt: now });
  await busyStore.healthCheck();
  busyStore.close();

  // Inactive public DCR clients and orphaned grants have finite sliding retention.
  const retentionPath = path.join(directory, "retention.sqlite");
  let retentionNow = 2_000_000_000_000;
  const retentionStore = new SQLiteSkylightOAuthStore({
    ...options(),
    databasePath: retentionPath,
    namespace: "retention-smoke",
    clientRetentionMs: 10,
    grantRetentionMs: 10,
    now: () => retentionNow,
  });
  await retentionStore.putClient({
    id: "sliding-client",
    redirectUris: [],
    createdAt: retentionNow,
  });
  retentionNow += 5;
  assert.equal((await retentionStore.getClient("sliding-client"))?.id, "sliding-client");
  retentionNow += 6;
  await retentionStore.cleanup();
  assert.equal((await retentionStore.getClient("sliding-client"))?.id, "sliding-client");
  retentionNow += 10;
  await retentionStore.cleanup();
  assert.equal(await retentionStore.getClient("sliding-client"), undefined);

  await retentionStore.putGrant({
    id: "derived-grant",
    clientId: "expired-client",
    subject: "retention-subject",
    resource: "https://calendar.example.test/",
    scopes: ["mcp"],
    createdAt: retentionNow,
  });
  await retentionStore.putAccessToken({
    tokenHash: "derived-access",
    tokenId: "derived-access-id",
    grantId: "derived-grant",
    subject: "retention-subject",
    clientId: "expired-client",
    resource: "https://calendar.example.test/",
    expiresAt: retentionNow + 50,
  });
  retentionNow += 20;
  await retentionStore.cleanup();
  assert.equal((await retentionStore.getGrant("derived-grant"))?.id, "derived-grant");
  retentionNow += 41;
  await retentionStore.cleanup();
  assert.equal(await retentionStore.getGrant("derived-grant"), undefined);
  assert.equal(await retentionStore.getAccessToken("derived-access"), undefined);
  retentionStore.close();

  // Provider credentials must not appear in either the main file or live WAL.
  const databaseFiles = [databasePath, `${databasePath}-wal`];
  for (const file of databaseFiles) {
    let bytes;
    try {
      bytes = await readFile(file);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    assert.equal(bytes.includes(Buffer.from(credentialV1.accessToken)), false);
    assert.equal(bytes.includes(Buffer.from(credentialV1.refreshToken)), false);
  }

  store.close();
  peer.close();
  store = undefined;
  peer = undefined;

  const restarted = new SQLiteSkylightOAuthStore(options());
  assert.equal((await restarted.getClient("client-1"))?.id, "client-1");
  assert.equal(
    (await restarted.credentials.get("hosted-subject"))?.refreshToken,
    "hosted-refresh-v3"
  );
  assert.equal(
    (await restarted.credentials.get("second-hosted-subject"))?.accessToken,
    "second-subject-access"
  );

  const rotatedEncryptionKey = Buffer.alloc(32, 0x7d);
  restarted.close();
  const rotated = new SQLiteSkylightOAuthStore({
    ...options(),
    encryptionKey: rotatedEncryptionKey,
    encryptionKeyId: "smoke-key-v2",
    decryptionKeys: { "smoke-key-v1": encryptionKey },
  });
  assert.equal(
    (await rotated.credentials.get("hosted-subject"))?.refreshToken,
    "hosted-refresh-v3"
  );
  await rotated.credentials.update("hosted-subject", (current) => ({
    ...current,
    fingerprint: "reencrypted-v2",
  }));
  rotated.close();

  const currentKeyOnly = new SQLiteSkylightOAuthStore({
    ...options(),
    encryptionKey: rotatedEncryptionKey,
    encryptionKeyId: "smoke-key-v2",
  });
  assert.equal(
    (await currentKeyOnly.credentials.get("hosted-subject"))?.fingerprint,
    "reencrypted-v2"
  );
  await assert.rejects(
    currentKeyOnly.credentials.get("second-hosted-subject"),
    /No decryption key is configured for credential key ID smoke-key-v1/
  );
  currentKeyOnly.close();

  if (process.platform !== "win32") {
    assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
  }
  console.log("oauth-sqlite-store-smoke-ok");
} finally {
  try {
    store?.close();
  } catch {}
  try {
    peer?.close();
  } catch {}
  await rm(directory, { recursive: true, force: true });
}
