import crypto from 'crypto';
import { sql } from './client.js';
import {
  initEncryptionKey, createOrgDek, decryptForOrg, decryptWithKek, encryptForOrg,
} from '../lib/crypto.js';
import { SEED_MODELS, SEED_FALLBACK } from './seed-catalog.js';

/**
 * Postgres (Supabase) init. Schema is managed by drizzle-kit migrations
 * (src/db/migrations) — applied via `drizzle-kit migrate`. This only seeds the
 * model catalog on a fresh DB and ensures the unified API key + encryption key.
 */
export async function initDb(): Promise<void> {
  await initEncryptionKey();
  await seedCatalog();
  await ensureOrgUnifiedKeys();
  await ensureDefaultClients();
  await ensureOrgDeks();
  await migrateLegacyProviderKeys();
  console.log('Database ready (Postgres)');
}

// Envelope encryption: ensure every org has a wrapped DEK.
async function ensureOrgDeks(): Promise<void> {
  const orgs = await sql<{ id: number }[]>`SELECT id FROM organizations WHERE dek_wrapped IS NULL`;
  for (const o of orgs) await createOrgDek(o.id);
  if (orgs.length) console.log(`[crypto] provisioned DEKs for ${orgs.length} org(s)`);
}

// One-time, idempotent re-encryption of provider keys from the legacy KEK-direct
// scheme to per-org DEKs. A row already sealed under its org DEK decrypts fine
// and is skipped; a legacy row (sealed under the KEK) is decrypted with the KEK
// and re-sealed under the org DEK.
async function migrateLegacyProviderKeys(): Promise<void> {
  const rows = await sql<{ id: number; org_id: number; encrypted_key: string; iv: string; auth_tag: string }[]>`
    SELECT id, org_id, encrypted_key, iv, auth_tag FROM api_keys`;
  let migrated = 0;
  for (const r of rows) {
    try {
      await decryptForOrg(r.org_id, r.encrypted_key, r.iv, r.auth_tag);
      continue; // already DEK-sealed
    } catch {
      // fall through to legacy path
    }
    let plaintext: string;
    try {
      plaintext = decryptWithKek(r.encrypted_key, r.iv, r.auth_tag);
    } catch {
      console.warn(`[crypto] api_keys#${r.id} not decryptable by DEK or KEK — leaving as-is`);
      continue;
    }
    const sealed = await encryptForOrg(r.org_id, plaintext);
    await sql`
      UPDATE api_keys SET encrypted_key = ${sealed.encrypted}, iv = ${sealed.iv}, auth_tag = ${sealed.authTag}
      WHERE id = ${r.id}`;
    migrated++;
  }
  if (migrated) console.log(`[crypto] re-encrypted ${migrated} provider key(s) KEK->DEK`);
}

async function seedCatalog(): Promise<void> {
  const [{ count }] = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM models`;
  if (count === 0) {
    for (const m of SEED_MODELS) {
      await sql`
        INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
          rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, supports_vision)
        VALUES (${m.platform}, ${m.model_id}, ${m.display_name}, ${m.intelligence_rank}, ${m.speed_rank},
          ${m.size_label}, ${m.rpm_limit}, ${m.rpd_limit}, ${m.tpm_limit}, ${m.tpd_limit},
          ${m.monthly_token_budget}, ${m.context_window}, ${m.enabled}, ${m.supports_vision})
        ON CONFLICT (platform, model_id) DO NOTHING`;
    }
    console.log(`Seeded ${SEED_MODELS.length} models`);
  }

  // Seed the fallback-chain TEMPLATE (org_id IS NULL) independently of the model
  // count — new orgs clone these rows (see createUser). The unique key is
  // (org_id, model_db_id) post-tenancy, so the ON CONFLICT target matches that.
  const [{ tcount }] = await sql<{ tcount: number }[]>`SELECT COUNT(*)::int AS tcount FROM fallback_config WHERE org_id IS NULL`;
  if (tcount === 0) {
    for (const f of SEED_FALLBACK) {
      await sql`
        INSERT INTO fallback_config (org_id, model_db_id, priority, enabled)
        SELECT NULL, id, ${f.priority}, ${f.enabled} FROM models WHERE platform = ${f.platform} AND model_id = ${f.model_id}
        ON CONFLICT (org_id, model_db_id) DO NOTHING`;
    }
    console.log(`Seeded ${SEED_FALLBACK.length} fallback-template rows`);
  }
}

function newUnifiedKey(): string {
  return `llmpanda-${crypto.randomBytes(24).toString('hex')}`;
}

// Defensive backfill: any org missing a unified key (e.g. created before the
// per-org key landed) gets one on boot. New orgs get theirs in createUser.
async function ensureOrgUnifiedKeys(): Promise<void> {
  const orgs = await sql<{ id: number }[]>`SELECT id FROM organizations WHERE unified_key IS NULL`;
  for (const o of orgs) {
    await sql`UPDATE organizations SET unified_key = ${newUnifiedKey()} WHERE id = ${o.id} AND unified_key IS NULL`;
  }
}

/** The unified API key for one org (shown on the dashboard's Connect page). */
export async function getUnifiedApiKey(orgId: number): Promise<string> {
  const rows = await sql<{ unified_key: string | null }[]>`SELECT unified_key FROM organizations WHERE id = ${orgId}`;
  return rows[0]?.unified_key ?? '';
}

/** Rotate one org's unified API key and return the new value. */
export async function regenerateUnifiedKey(orgId: number): Promise<string> {
  const key = newUnifiedKey();
  await sql`UPDATE organizations SET unified_key = ${key} WHERE id = ${orgId}`;
  return key;
}

/**
 * Resolve an incoming /v1 unified API key to its owning org id, or null if the
 * key is unknown. Legacy single-key path; resolveOrgByClientKey supersedes it.
 */
export async function resolveOrgByUnifiedKey(token: string): Promise<number | null> {
  if (!token) return null;
  const rows = await sql<{ id: number }[]>`SELECT id FROM organizations WHERE unified_key = ${token}`;
  return rows[0]?.id ?? null;
}

// ── Phase 3: per-org client API keys (hashed, revocable) ─────────────────────
function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function keyPrefixOf(key: string): string {
  return key.slice(0, 16);
}

// Ensure every org has at least one client key. Backfills a "Default" client
// from the legacy organizations.unified_key (hashing the existing plaintext) so
// keys already handed out keep working after the switch to hashed client keys.
async function ensureDefaultClients(): Promise<void> {
  const orgs = await sql<{ id: number; unified_key: string | null }[]>`
    SELECT o.id, o.unified_key FROM organizations o
    WHERE NOT EXISTS (SELECT 1 FROM api_clients c WHERE c.org_id = o.id)`;
  for (const o of orgs) {
    const key = o.unified_key ?? newUnifiedKey();
    await sql`
      INSERT INTO api_clients (org_id, name, key_prefix, key_hash)
      VALUES (${o.id}, 'Default', ${keyPrefixOf(key)}, ${sha256hex(key)})
      ON CONFLICT (key_hash) DO NOTHING`;
  }
}

/**
 * Resolve an incoming /v1 token to its owning org. Hashes the token and looks up
 * a non-revoked client key; falls back to the legacy unified_key. Touches
 * last_used_at. This is the tenant boundary for the proxy: the returned org is
 * the ONLY org whose provider keys, fallback chain and quotas may serve the call.
 */
export async function resolveOrgByClientKey(token: string): Promise<number | null> {
  if (!token) return null;
  const rows = await sql<{ id: number; org_id: number }[]>`
    SELECT id, org_id FROM api_clients WHERE key_hash = ${sha256hex(token)} AND revoked_at IS NULL`;
  if (rows[0]) {
    // best-effort usage stamp; never block the request on it
    sql`UPDATE api_clients SET last_used_at = now() WHERE id = ${rows[0].id}`.catch(() => {});
    return rows[0].org_id;
  }
  return resolveOrgByUnifiedKey(token);
}

/** Create a new named client key for an org. Returns the plaintext ONCE. */
export async function createClientKey(orgId: number, name: string): Promise<{ id: number; name: string; key: string; keyPrefix: string }> {
  const key = newUnifiedKey();
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO api_clients (org_id, name, key_prefix, key_hash)
    VALUES (${orgId}, ${name || 'Untitled'}, ${keyPrefixOf(key)}, ${sha256hex(key)})
    RETURNING id`;
  return { id: row.id, name: name || 'Untitled', key, keyPrefix: keyPrefixOf(key) };
}

/** List an org's client keys (metadata only — never the hash or plaintext). */
export async function listClientKeys(orgId: number): Promise<Array<{ id: number; name: string; keyPrefix: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }>> {
  return await sql<any[]>`
    SELECT id, name, key_prefix AS "keyPrefix", last_used_at AS "lastUsedAt",
           revoked_at AS "revokedAt", created_at AS "createdAt"
    FROM api_clients WHERE org_id = ${orgId} ORDER BY created_at ASC`;
}

/** Revoke one client key (scoped to the org). Returns true if a row changed. */
export async function revokeClientKey(orgId: number, id: number): Promise<boolean> {
  const res = await sql`UPDATE api_clients SET revoked_at = now() WHERE id = ${id} AND org_id = ${orgId} AND revoked_at IS NULL`;
  return res.count > 0;
}

// Generic key/value settings accessors (routing strategy, etc.).
export async function getSetting(key: string): Promise<string | undefined> {
  const rows = await sql<{ value: string }[]>`SELECT value FROM settings WHERE key = ${key}`;
  return rows[0]?.value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
}
