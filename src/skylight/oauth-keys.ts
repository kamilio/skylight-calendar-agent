import {
  createECDH,
  createPrivateKey,
  hkdfSync,
  type KeyObject,
} from "node:crypto";

export interface OAuthKeyMaterial {
  encryptionKey: Buffer;
  subjectKey: Buffer;
  signingPrivateKey: KeyObject;
}

const DERIVATION_SALT = Buffer.from(
  "skylight-calendar-agent/hosted-oauth/v1",
  "utf8"
);

function decodeMasterKey(value: string): Buffer {
  let normalized = value.trim();
  while (normalized.endsWith("=")) normalized = normalized.slice(0, -1);
  const key = Buffer.from(normalized, "base64url");
  if (key.byteLength !== 32 || key.toString("base64url") !== normalized) {
    throw new Error(
      "SKYLIGHT_OAUTH_MASTER_KEY must be a 32-byte base64url value."
    );
  }
  return key;
}

function derive(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey,
      DERIVATION_SALT,
      Buffer.from(purpose, "utf8"),
      32
    )
  );
}

function signingPrivateKey(masterKey: Buffer): KeyObject {
  for (let counter = 0; counter < 256; counter += 1) {
    const privateScalar = derive(masterKey, `signing-key/${counter}`);
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(privateScalar);
      const publicPoint = ecdh.getPublicKey(undefined, "uncompressed");
      return createPrivateKey({
        key: {
          kty: "EC",
          crv: "P-256",
          d: privateScalar.toString("base64url"),
          x: publicPoint.subarray(1, 33).toString("base64url"),
          y: publicPoint.subarray(33, 65).toString("base64url"),
        },
        format: "jwk",
      });
    } catch {
      // An HKDF output is almost always a valid P-256 scalar. A deterministic
      // counter makes the vanishingly rare invalid output recoverable.
    }
  }
  throw new Error("Could not derive a valid hosted OAuth signing key.");
}

/** Derive independent stable keys from one deployment secret. */
export function deriveOAuthKeyMaterial(value: string): OAuthKeyMaterial {
  const masterKey = decodeMasterKey(value);
  return {
    encryptionKey: derive(masterKey, "credential-encryption"),
    subjectKey: derive(masterKey, "subject-hmac"),
    signingPrivateKey: signingPrivateKey(masterKey),
  };
}
