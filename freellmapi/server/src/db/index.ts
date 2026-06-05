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
  await ensureProviderModels();
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

// Models for newly-added providers (P2). seedCatalog only runs on a fresh DB, so
// this idempotent upsert ensures these rows exist on existing DBs too, adds a
// fallback-chain template row, and enrolls them in every org's chain (enabled,
// low priority). They only route once the org adds that provider's key (BYOK).
const NEW_PROVIDER_MODELS: Array<{ platform: string; model_id: string; display_name: string; intelligence_rank: number; speed_rank: number; size_label: string; context_window: number }> = [
  // OpenCode Free (verified ids from /zen/go/v1/models; free OpenCode token)
  { platform: 'opencode-free', model_id: 'minimax-m2.7', display_name: 'MiniMax M2.7 (OpenCode Free)', intelligence_rank: 4, speed_rank: 6, size_label: 'Large', context_window: 256000 },
  { platform: 'opencode-free', model_id: 'minimax-m2.5', display_name: 'MiniMax M2.5 (OpenCode Free)', intelligence_rank: 5, speed_rank: 6, size_label: 'Large', context_window: 256000 },
  { platform: 'opencode-free', model_id: 'kimi-k2.6', display_name: 'Kimi K2.6 (OpenCode Free)', intelligence_rank: 4, speed_rank: 6, size_label: 'Large', context_window: 256000 },
  { platform: 'opencode-free', model_id: 'glm-5', display_name: 'GLM-5 (OpenCode Free)', intelligence_rank: 4, speed_rank: 6, size_label: 'Large', context_window: 200000 },
  { platform: 'opencode-free', model_id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro (OpenCode Free)', intelligence_rank: 3, speed_rank: 6, size_label: 'Frontier', context_window: 163840 },
  { platform: 'opencode-free', model_id: 'qwen3.7-plus', display_name: 'Qwen3.7 Plus (OpenCode Free)', intelligence_rank: 3, speed_rank: 6, size_label: 'Large', context_window: 262144 },
  // Chutes.ai (HuggingFace-style ids; BYOK free account)
  { platform: 'chutes', model_id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8', display_name: 'Qwen3 Coder 480B (Chutes)', intelligence_rank: 2, speed_rank: 6, size_label: 'Frontier', context_window: 262144 },
  { platform: 'chutes', model_id: 'zai-org/GLM-4.6', display_name: 'GLM-4.6 (Chutes)', intelligence_rank: 4, speed_rank: 6, size_label: 'Large', context_window: 200000 },
  { platform: 'chutes', model_id: 'deepseek-ai/DeepSeek-V3.1', display_name: 'DeepSeek V3.1 (Chutes)', intelligence_rank: 3, speed_rank: 6, size_label: 'Frontier', context_window: 163840 },
  { platform: 'chutes', model_id: 'MiniMaxAI/MiniMax-M2', display_name: 'MiniMax M2 (Chutes)', intelligence_rank: 5, speed_rank: 6, size_label: 'Large', context_window: 200000 },
  // Alibaba DashScope (Qwen) — BYOK, free tier
  { platform: 'dashscope', model_id: 'qwen3-coder-plus', display_name: 'Qwen3 Coder Plus (DashScope)', intelligence_rank: 2, speed_rank: 5, size_label: 'Frontier', context_window: 1000000 },
  { platform: 'dashscope', model_id: 'qwen-max', display_name: 'Qwen Max (DashScope)', intelligence_rank: 4, speed_rank: 6, size_label: 'Large', context_window: 32768 },
  // Alibaba ModelScope — BYOK, free tier
  { platform: 'modelscope', model_id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', display_name: 'Qwen3 Coder 480B (ModelScope)', intelligence_rank: 2, speed_rank: 6, size_label: 'Frontier', context_window: 262144 },
];

async function ensureProviderModels(): Promise<void> {
  for (const m of NEW_PROVIDER_MODELS) {
    await sql`
      INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
        rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled, supports_vision)
      VALUES (${m.platform}, ${m.model_id}, ${m.display_name}, ${m.intelligence_rank}, ${m.speed_rank}, ${m.size_label},
        null, null, null, null, '~free', ${m.context_window}, 1, 0)
      ON CONFLICT (platform, model_id) DO NOTHING`;
    // Fallback-chain template row (org_id IS NULL) — guard against duplicates
    // since NULL org_id is distinct in the unique index.
    await sql`
      INSERT INTO fallback_config (org_id, model_db_id, priority, enabled)
      SELECT NULL, mo.id, 900, 1 FROM models mo
      WHERE mo.platform = ${m.platform} AND mo.model_id = ${m.model_id}
        AND NOT EXISTS (SELECT 1 FROM fallback_config f WHERE f.org_id IS NULL AND f.model_db_id = mo.id)`;
    // Enroll in every existing org's chain (skipped at route time until a key exists).
    await sql`
      INSERT INTO fallback_config (org_id, model_db_id, priority, enabled)
      SELECT o.id, mo.id, 900, 1 FROM organizations o CROSS JOIN models mo
      WHERE mo.platform = ${m.platform} AND mo.model_id = ${m.model_id}
      ON CONFLICT (org_id, model_db_id) DO NOTHING`;
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

// Parse the api_clients.allowed_model_ids JSON column → number[] | null.
// NULL / empty / malformed = no restriction.
function parseAllowedModelIds(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const ids = v.filter((n): n is number => typeof n === 'number');
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Resolve an incoming /v1 token to the full client-key context: owning org, the
 * client key id, and its model allow-list. Hashes the token, looks up a
 * non-revoked client key, falls back to the legacy unified_key (no allow-list).
 * Touches last_used_at. This is the tenant boundary for the proxy: the returned
 * org is the ONLY org whose provider keys, fallback chain and quotas serve the
 * call, and `allowedModelIds` (when set) restricts routing to those models.
 */
export interface ClientKeyContext {
  orgId: number;
  keyId: number;
  allowedModelIds: number[] | null;
  tokenSaver: boolean;
  terseMode: boolean;
  terseLevel: string | null;
}

export async function resolveClientKeyFull(token: string): Promise<ClientKeyContext | null> {
  if (!token) return null;
  const rows = await sql<{ id: number; org_id: number; allowed_model_ids: string | null; token_saver: number; terse_mode: number; terse_level: string | null }[]>`
    SELECT id, org_id, allowed_model_ids, token_saver, terse_mode, terse_level FROM api_clients
    WHERE key_hash = ${sha256hex(token)} AND revoked_at IS NULL`;
  if (rows[0]) {
    // best-effort usage stamp; never block the request on it
    sql`UPDATE api_clients SET last_used_at = now() WHERE id = ${rows[0].id}`.catch(() => {});
    return {
      orgId: rows[0].org_id,
      keyId: rows[0].id,
      allowedModelIds: parseAllowedModelIds(rows[0].allowed_model_ids),
      tokenSaver: rows[0].token_saver === 1,
      terseMode: rows[0].terse_mode === 1,
      terseLevel: rows[0].terse_level,
    };
  }
  const orgId = await resolveOrgByUnifiedKey(token);
  return orgId === null ? null : { orgId, keyId: 0, allowedModelIds: null, tokenSaver: false, terseMode: false, terseLevel: null };
}

/**
 * Backward-compatible resolver returning only the org id (used by callers that
 * don't need the allow-list, e.g. the embeddings route).
 */
export async function resolveOrgByClientKey(token: string): Promise<number | null> {
  const full = await resolveClientKeyFull(token);
  return full ? full.orgId : null;
}

/** Create a new named client key for an org. Returns the plaintext ONCE. */
export async function createClientKey(
  orgId: number,
  name: string,
  allowedModelIds?: number[],
): Promise<{ id: number; name: string; key: string; keyPrefix: string }> {
  const key = newUnifiedKey();
  const allowed = allowedModelIds && allowedModelIds.length > 0 ? JSON.stringify(allowedModelIds) : null;
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO api_clients (org_id, name, key_prefix, key_hash, allowed_model_ids)
    VALUES (${orgId}, ${name || 'Untitled'}, ${keyPrefixOf(key)}, ${sha256hex(key)}, ${allowed})
    RETURNING id`;
  return { id: row.id, name: name || 'Untitled', key, keyPrefix: keyPrefixOf(key) };
}

/**
 * Update a client key's name and/or model allow-list (org-scoped).
 * `allowedModelIds: []` or `null` clears the restriction. Returns true if a row
 * changed.
 */
export async function updateClientKey(
  orgId: number,
  id: number,
  patch: { name?: string; allowedModelIds?: number[] | null; tokenSaver?: boolean; terseMode?: boolean; terseLevel?: string | null },
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.allowedModelIds !== undefined) {
    set.allowed_model_ids = patch.allowedModelIds && patch.allowedModelIds.length > 0 ? JSON.stringify(patch.allowedModelIds) : null;
  }
  if (patch.tokenSaver !== undefined) set.token_saver = patch.tokenSaver ? 1 : 0;
  if (patch.terseMode !== undefined) set.terse_mode = patch.terseMode ? 1 : 0;
  if (patch.terseLevel !== undefined) set.terse_level = patch.terseLevel;
  if (Object.keys(set).length === 0) return false;
  const res = await sql`UPDATE api_clients SET ${sql(set)} WHERE id = ${id} AND org_id = ${orgId}`;
  return res.count > 0;
}

/** List an org's client keys (metadata only — never the hash or plaintext). */
export async function listClientKeys(orgId: number): Promise<Array<{ id: number; name: string; keyPrefix: string; allowedModelIds: number[] | null; tokenSaver: boolean; terseMode: boolean; terseLevel: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }>> {
  const rows = await sql<any[]>`
    SELECT id, name, key_prefix AS "keyPrefix", allowed_model_ids AS "allowedModelIds",
           token_saver AS "tokenSaver", terse_mode AS "terseMode", terse_level AS "terseLevel",
           last_used_at AS "lastUsedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
    FROM api_clients WHERE org_id = ${orgId} ORDER BY created_at ASC`;
  return rows.map(r => ({ ...r, allowedModelIds: parseAllowedModelIds(r.allowedModelIds), tokenSaver: r.tokenSaver === 1, terseMode: r.terseMode === 1 }));
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
