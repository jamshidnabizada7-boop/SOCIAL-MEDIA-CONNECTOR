import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AES-256-GCM envelope for OAuth credentials. Ciphertext format:
 *   v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>
 *
 * The key comes from ARIA_ENCRYPTION_KEY (32 raw bytes, hex or base64).
 * In production this must live in a KMS/secret manager — never in the repo.
 */

const PREFIX = "v1";

/**
 * Local development convenience: when ARIA_ENCRYPTION_KEY is unset outside
 * production, generate a key once and persist it under .local/ so OAuth
 * works out of the box without env setup. Production must configure the env.
 */
function devKeyFile(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.local/encryption.key"
  );
}

function ensureKey(): string {
  const raw = process.env.ARIA_ENCRYPTION_KEY;
  if (raw) return raw;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ARIA_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32"
    );
  }
  const file = devKeyFile();
  try {
    process.env.ARIA_ENCRYPTION_KEY = readFileSync(file, "utf8").trim();
  } catch {
    mkdirSync(path.dirname(file), { recursive: true });
    process.env.ARIA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    writeFileSync(file, process.env.ARIA_ENCRYPTION_KEY, { mode: 0o600 });
  }
  return process.env.ARIA_ENCRYPTION_KEY;
}

function keyFromEnv(): Buffer {
  const raw = ensureKey();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const asBase64 = Buffer.from(raw, "base64");
  if (asBase64.length === 32) return asBase64;
  // Fallback: derive a stable key from the provided secret.
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnv(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(value: string): string {
  const [prefix, ivB64, tagB64, dataB64] = value.split(":");
  if (prefix !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unrecognized ciphertext envelope");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFromEnv(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Opaque session/API-key tokens are stored only as sha256 digests. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}
