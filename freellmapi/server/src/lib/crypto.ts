import crypto from 'crypto';
import { sql } from '../db/client.js';

// Envelope encryption.
//   KEK (master Key-Encryption-Key)  — from ENCRYPTION_KEY env; wraps DEKs only.
//   DEK (per-org Data-Encryption-Key) — random 32B per org; encrypts that org's
//        provider keys. Stored wrapped (AES-256-GCM) by the KEK on the org row.
// A DB leak yields only wrapped DEKs — useless without the KEK, which lives in
// env / a secrets manager, never in the database. One org's DEK never decrypts
// another org's data.

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const KEY_HEX_LEN = KEY_BYTES * 2;
const PLACEHOLDER_KEY = 'your-64-char-hex-key-here';

let kek: Buffer | null = null;
const orgDekCache = new Map<number, Buffer>();

export interface Sealed {
  encrypted: string;
  iv: string;
  authTag: string;
}

// ── Low-level AES-256-GCM ─────────────────────────────────────────────────────
function aesEncrypt(key: Buffer, plaintext: string): Sealed {
  // 12-byte nonce is the GCM standard. Random per call → no nonce reuse.
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

function aesDecrypt(key: Buffer, encrypted: string, iv: string, authTag: string): string {
  // Accepts any stored IV length (legacy rows used 16B) — GCM verifies the tag.
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── KEK bootstrap ─────────────────────────────────────────────────────────────
function parseHexKey(value: string, source: 'env' | 'db'): Buffer {
  if (value.length !== KEY_HEX_LEN || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(
      `Invalid ENCRYPTION_KEY (${source}): expected ${KEY_HEX_LEN} hex chars (32 bytes), got ${value.length} chars. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(value, 'hex');
}

function isDevFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function missingKeyError(): Error {
  return new Error(
    'ENCRYPTION_KEY is required in production for API key encryption. ' +
    `Set a ${KEY_HEX_LEN}-char hex key (generate one with: ` +
    `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"). ` +
    'Outside production a local DB-stored key is auto-generated.',
  );
}

/**
 * Load the master KEK from env (preferred) or, in dev only, a DB-persisted
 * fallback. Must run after the DB is initialized. In production a DB-stored KEK
 * is refused — the master key must come from outside the database.
 */
export async function initEncryptionKey(): Promise<void> {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey && envKey !== PLACEHOLDER_KEY) {
    kek = parseHexKey(envKey, 'env');
    return;
  }

  if (!isDevFallbackAllowed()) {
    throw missingKeyError();
  }

  const rows = await sql<{ value: string }[]>`SELECT value FROM settings WHERE key = 'encryption_key'`;
  if (rows[0]) {
    kek = parseHexKey(rows[0].value, 'db');
    console.warn('[crypto] No ENCRYPTION_KEY env — using DB-stored KEK (dev only). Set ENCRYPTION_KEY + delete the DB row for production.');
    return;
  }

  kek = crypto.randomBytes(KEY_BYTES);
  await sql`INSERT INTO settings (key, value) VALUES ('encryption_key', ${kek.toString('hex')})`;
  console.warn('[crypto] No ENCRYPTION_KEY env — generated a dev KEK in the DB. Set ENCRYPTION_KEY for production.');
}

function getKek(): Buffer {
  if (!kek) throw new Error('Encryption key not initialized. Call initEncryptionKey() first.');
  return kek;
}

/** Decrypt a blob sealed directly under the KEK (legacy pre-envelope rows). */
export function decryptWithKek(encrypted: string, iv: string, authTag: string): string {
  return aesDecrypt(getKek(), encrypted, iv, authTag);
}

// ── Per-org DEK ───────────────────────────────────────────────────────────────
/** Generate + wrap + persist a DEK for an org. Race-safe: the stored value wins. */
export async function createOrgDek(orgId: number): Promise<Buffer> {
  const dek = crypto.randomBytes(KEY_BYTES);
  const wrapped = aesEncrypt(getKek(), dek.toString('hex'));
  await sql`
    UPDATE organizations
    SET dek_wrapped = ${wrapped.encrypted}, dek_iv = ${wrapped.iv}, dek_tag = ${wrapped.authTag}
    WHERE id = ${orgId} AND dek_wrapped IS NULL`;
  // Re-read so concurrent creators converge on the single stored DEK.
  const [row] = await sql<{ dek_wrapped: string; dek_iv: string; dek_tag: string }[]>`
    SELECT dek_wrapped, dek_iv, dek_tag FROM organizations WHERE id = ${orgId}`;
  const authoritative = Buffer.from(aesDecrypt(getKek(), row.dek_wrapped, row.dek_iv, row.dek_tag), 'hex');
  orgDekCache.set(orgId, authoritative);
  return authoritative;
}

async function loadOrgDek(orgId: number): Promise<Buffer> {
  const cached = orgDekCache.get(orgId);
  if (cached) return cached;
  const [row] = await sql<{ dek_wrapped: string | null; dek_iv: string | null; dek_tag: string | null }[]>`
    SELECT dek_wrapped, dek_iv, dek_tag FROM organizations WHERE id = ${orgId}`;
  if (row?.dek_wrapped && row.dek_iv && row.dek_tag) {
    const dek = Buffer.from(aesDecrypt(getKek(), row.dek_wrapped, row.dek_iv, row.dek_tag), 'hex');
    orgDekCache.set(orgId, dek);
    return dek;
  }
  return createOrgDek(orgId);
}

/** Drop a cached DEK (e.g. after org deletion). */
export function evictOrgDek(orgId: number): void {
  orgDekCache.delete(orgId);
}

/** Encrypt a provider key for an org with that org's DEK. */
export async function encryptForOrg(orgId: number, text: string): Promise<Sealed> {
  return aesEncrypt(await loadOrgDek(orgId), text);
}

/** Decrypt a provider key for an org with that org's DEK. */
export async function decryptForOrg(orgId: number, encrypted: string, iv: string, authTag: string): Promise<string> {
  return aesDecrypt(await loadOrgDek(orgId), encrypted, iv, authTag);
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '...' + key.slice(-4);
}
