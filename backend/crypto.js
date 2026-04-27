// @ts-check
/**
 * Symmetric encryption helpers for at-rest secrets (OAuth tokens, CalDAV
 * passwords). Uses AES-256-GCM with a random 12-byte IV per record.
 *
 * The master key is loaded from the `INTEGRATIONS_ENCRYPTION_KEY` env var.
 * Accepted formats:
 *   - 64 hex chars (32 bytes)
 *   - 44-char base64 (32 bytes, with or without padding)
 *
 * Security notes:
 *   - IV is random per call; NEVER reuse an IV under the same key.
 *   - GCM auth tag (16 bytes) is appended to the ciphertext — tampering
 *     detectable on decrypt.
 *   - The optional `aad` (Additional Authenticated Data) argument binds
 *     ciphertext to a context (e.g. integration id) so swapped-blob attacks
 *     fail decryption.
 *   - If the key is missing or malformed, `isEncryptionAvailable()` returns
 *     false and integrations routes degrade gracefully (503) rather than
 *     storing plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits, GCM standard
const TAG_LENGTH = 16;

/** @type {Buffer | null} */
let cachedKey = null;
/** @type {string | null} */
let cachedKeyError = null;

function loadKey() {
  if (cachedKey || cachedKeyError) return { key: cachedKey, error: cachedKeyError };

  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw) {
    cachedKeyError = "INTEGRATIONS_ENCRYPTION_KEY is not set";
    return { key: null, error: cachedKeyError };
  }

  // Try hex first (64 chars), then base64.
  let buf = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, "hex");
  } else {
    try {
      const decoded = Buffer.from(raw, "base64");
      if (decoded.length === KEY_LENGTH) buf = decoded;
    } catch {
      // fall through
    }
  }

  if (!buf || buf.length !== KEY_LENGTH) {
    cachedKeyError = "INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)";
    return { key: null, error: cachedKeyError };
  }

  cachedKey = buf;
  return { key: cachedKey, error: null };
}

export function isEncryptionAvailable() {
  return loadKey().key != null;
}

export function getEncryptionUnavailableReason() {
  return loadKey().error;
}

/**
 * Encrypt a UTF-8 plaintext string. Output format:
 *   `v1:${ivB64}:${ciphertextAndTagB64}`
 *
 * The `v1:` prefix lets us rotate formats later without a migration.
 *
 * @param {string} plaintext
 * @param {string} [aad] optional context, verified on decrypt
 * @returns {string}
 */
export function encryptSecret(plaintext, aad) {
  const { key, error } = loadKey();
  if (!key) throw new Error(`Encryption unavailable: ${error}`);
  if (typeof plaintext !== "string") throw new TypeError("plaintext must be a string");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}

/**
 * Decrypt a blob produced by `encryptSecret`. Throws on any tamper / bad key.
 *
 * @param {string} blob
 * @param {string} [aad] must match the aad used on encrypt (if any)
 * @returns {string}
 */
export function decryptSecret(blob, aad) {
  const { key, error } = loadKey();
  if (!key) throw new Error(`Encryption unavailable: ${error}`);
  if (typeof blob !== "string" || !blob.startsWith("v1:")) {
    throw new Error("Invalid ciphertext format");
  }

  const parts = blob.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");

  const iv = Buffer.from(parts[1], "base64");
  const combined = Buffer.from(parts[2], "base64");
  if (iv.length !== IV_LENGTH) throw new Error("Invalid IV length");
  if (combined.length < TAG_LENGTH + 1) throw new Error("Ciphertext too short");

  const ciphertext = combined.subarray(0, combined.length - TAG_LENGTH);
  const tag = combined.subarray(combined.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

/**
 * Generate a freshly random 32-byte hex string — useful as a one-liner
 * for provisioning the master key:
 *
 *   node -e "import('./backend/crypto.js').then(m => console.log(m.generateMasterKeyHex()))"
 */
export function generateMasterKeyHex() {
  return randomBytes(KEY_LENGTH).toString("hex");
}
