// Sliding-window rate-limit tracker, Postgres-backed (stateless / multi-instance
// safe). Counters + cooldowns live in Postgres; only the cooldown-escalation
// heuristic is kept in memory (a best-effort tier counter that may reset on
// restart — acceptable, as the persisted cooldown row is the source of truth).

import { sql } from '../db/client.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const HOUR = 60 * MINUTE;

type UsageKind = 'request' | 'tokens';

// Reads below stay keyed by key_id (which is globally unique → already implies
// one org). org_id is stamped on writes only, for tenant-scoped dashboard reads
// and NOT NULL integrity.
async function recordUsage(
  orgId: number,
  platform: string,
  modelId: string,
  keyId: number,
  kind: UsageKind,
  tokens: number,
  now: number,
): Promise<void> {
  await sql`
    INSERT INTO rate_limit_usage (org_id, platform, model_id, key_id, kind, tokens, created_at_ms)
    VALUES (${orgId}, ${platform}, ${modelId}, ${keyId}, ${kind}, ${tokens}, ${now})`;
  await sql`DELETE FROM rate_limit_usage WHERE created_at_ms <= ${now - DAY}`;
}

// All reads also constrain org_id. key_id alone already implies one org (api_keys.id
// is globally unique), but filtering org_id makes tenant isolation enforced by the
// query, not by that invariant — the no-RLS posture wants defense-in-depth here.
async function requestCount(
  orgId: number,
  platform: string,
  modelId: string,
  keyId: number,
  windowMs: number,
  now: number,
): Promise<number> {
  const [row] = await sql<{ used: number }[]>`
    SELECT COUNT(*)::int AS used FROM rate_limit_usage
     WHERE org_id = ${orgId} AND platform = ${platform} AND model_id = ${modelId} AND key_id = ${keyId}
       AND kind = 'request' AND created_at_ms > ${now - windowMs}`;
  return row.used;
}

async function tokenCount(
  orgId: number,
  platform: string,
  modelId: string,
  keyId: number,
  windowMs: number,
  now: number,
): Promise<number> {
  const [row] = await sql<{ used: number }[]>`
    SELECT COALESCE(SUM(tokens), 0)::int AS used FROM rate_limit_usage
     WHERE org_id = ${orgId} AND platform = ${platform} AND model_id = ${modelId} AND key_id = ${keyId}
       AND kind = 'tokens' AND created_at_ms > ${now - windowMs}`;
  return row.used;
}

export async function canMakeRequest(
  orgId: number,
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null },
): Promise<boolean> {
  const now = Date.now();
  if (limits.rpm !== null && (await requestCount(orgId, platform, modelId, keyId, MINUTE, now)) >= limits.rpm) return false;
  if (limits.rpd !== null && (await requestCount(orgId, platform, modelId, keyId, DAY, now)) >= limits.rpd) return false;
  return true;
}

export async function canUseTokens(
  orgId: number,
  platform: string,
  modelId: string,
  keyId: number,
  estimatedTokens: number,
  limits: { tpm: number | null; tpd: number | null },
): Promise<boolean> {
  const now = Date.now();
  if (limits.tpm !== null && (await tokenCount(orgId, platform, modelId, keyId, MINUTE, now)) + estimatedTokens > limits.tpm) return false;
  if (limits.tpd !== null && (await tokenCount(orgId, platform, modelId, keyId, DAY, now)) + estimatedTokens > limits.tpd) return false;
  return true;
}

export async function recordRequest(orgId: number, platform: string, modelId: string, keyId: number): Promise<void> {
  await recordUsage(orgId, platform, modelId, keyId, 'request', 0, Date.now());
}

export async function recordTokens(orgId: number, platform: string, modelId: string, keyId: number, tokens: number): Promise<void> {
  await recordUsage(orgId, platform, modelId, keyId, 'tokens', tokens, Date.now());
}

// ── Cooldowns ───────────────────────────────────────────────────────────────
// Escalating-tier heuristic: in-memory best-effort (resets on restart).
const cooldownHits = new Map<string, number[]>();
const COOLDOWN_DURATIONS = [2 * MINUTE, 10 * MINUTE, HOUR, DAY];
const TRANSIENT_COOLDOWN_MS = 90 * 1000;

export function getNextCooldownDuration(platform: string, modelId: string, keyId: number): number {
  const key = `${platform}:${modelId}:${keyId}`;
  const now = Date.now();
  const hits = (cooldownHits.get(key) ?? []).filter(t => t > now - DAY);
  hits.push(now);
  cooldownHits.set(key, hits);
  const idx = Math.min(hits.length - 1, COOLDOWN_DURATIONS.length - 1);
  return COOLDOWN_DURATIONS[idx]!;
}

export async function getCooldownDurationForLimit(
  orgId: number,
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpd: number | null; tpd: number | null },
): Promise<number> {
  const now = Date.now();
  const rpdExhausted = limits.rpd !== null && (await requestCount(orgId, platform, modelId, keyId, DAY, now)) >= limits.rpd;
  const tpdExhausted = limits.tpd !== null && (await tokenCount(orgId, platform, modelId, keyId, DAY, now)) >= limits.tpd;
  if (rpdExhausted || tpdExhausted) return getNextCooldownDuration(platform, modelId, keyId);
  return TRANSIENT_COOLDOWN_MS;
}

export async function setCooldown(orgId: number, platform: string, modelId: string, keyId: number, durationMs = 60_000): Promise<void> {
  const expiresAtMs = Date.now() + durationMs;
  await sql`
    INSERT INTO rate_limit_cooldowns (org_id, platform, model_id, key_id, expires_at_ms)
    VALUES (${orgId}, ${platform}, ${modelId}, ${keyId}, ${expiresAtMs})
    ON CONFLICT (platform, model_id, key_id) DO UPDATE SET expires_at_ms = excluded.expires_at_ms`;
}

export async function isOnCooldown(orgId: number, platform: string, modelId: string, keyId: number): Promise<boolean> {
  const now = Date.now();
  const [row] = await sql<{ expires_at_ms: number }[]>`
    SELECT expires_at_ms FROM rate_limit_cooldowns
     WHERE org_id = ${orgId} AND platform = ${platform} AND model_id = ${modelId} AND key_id = ${keyId}`;
  if (!row) return false;
  if (now > row.expires_at_ms) {
    await sql`DELETE FROM rate_limit_cooldowns WHERE org_id = ${orgId} AND platform = ${platform} AND model_id = ${modelId} AND key_id = ${keyId}`;
    return false;
  }
  return true;
}

export async function getRateLimitStatus(
  orgId: number,
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null },
) {
  const now = Date.now();
  return {
    rpm: { used: await requestCount(orgId, platform, modelId, keyId, MINUTE, now), limit: limits.rpm },
    rpd: { used: await requestCount(orgId, platform, modelId, keyId, DAY, now), limit: limits.rpd },
    tpm: { used: await tokenCount(orgId, platform, modelId, keyId, MINUTE, now), limit: limits.tpm },
  };
}
