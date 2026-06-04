/**
 * Rotate the master KEK. Re-wraps every org's DEK under a new KEK — the DEKs and
 * all provider-key ciphertext are unchanged, so this is fast and safe.
 *
 *   OLD_ENCRYPTION_KEY=<current 64-hex> ENCRYPTION_KEY=<new 64-hex> \
 *     [DATABASE_URL=...] npx tsx src/scripts/rotate-kek.ts
 *
 * Then set ENCRYPTION_KEY=<new> in the environment and restart. Keep the OLD key
 * until you've confirmed the app boots + decrypts with the new one.
 */
import crypto from 'crypto';
import postgres from 'postgres';

const ALGORITHM = 'aes-256-gcm';

function aesDecrypt(key: Buffer, encrypted: string, iv: string, authTag: string): string {
  const d = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(authTag, 'hex'));
  return d.update(encrypted, 'hex', 'utf8') + d.final('utf8');
}

function aesEncrypt(key: Buffer, plaintext: string): { encrypted: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = c.update(plaintext, 'utf8', 'hex') + c.final('hex');
  return { encrypted, iv: iv.toString('hex'), authTag: c.getAuthTag().toString('hex') };
}

function parseKey(value: string | undefined, name: string): Buffer {
  if (!value || value.length !== 64 || !/^[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${name} must be 64 hex chars (32 bytes)`);
  }
  return Buffer.from(value, 'hex');
}

(async () => {
  const oldKek = parseKey(process.env.OLD_ENCRYPTION_KEY, 'OLD_ENCRYPTION_KEY');
  const newKek = parseKey(process.env.ENCRYPTION_KEY, 'ENCRYPTION_KEY');
  if (oldKek.equals(newKek)) throw new Error('OLD_ENCRYPTION_KEY and ENCRYPTION_KEY are identical');

  const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres', { max: 4 });
  try {
    const orgs = await sql<{ id: number; dek_wrapped: string; dek_iv: string; dek_tag: string }[]>`
      SELECT id, dek_wrapped, dek_iv, dek_tag FROM organizations WHERE dek_wrapped IS NOT NULL`;
    let n = 0;
    for (const o of orgs) {
      const dekHex = aesDecrypt(oldKek, o.dek_wrapped, o.dek_iv, o.dek_tag); // throws if OLD key is wrong
      const w = aesEncrypt(newKek, dekHex);
      await sql`UPDATE organizations SET dek_wrapped = ${w.encrypted}, dek_iv = ${w.iv}, dek_tag = ${w.authTag} WHERE id = ${o.id}`;
      n++;
    }
    console.log(`Re-wrapped ${n} org DEK(s) under the new KEK. Set ENCRYPTION_KEY=<new> and restart.`);
  } finally {
    await sql.end();
  }
})().catch(e => { console.error('rotate-kek failed:', e.message); process.exit(1); });
