import { getSetting, setSetting } from '../db/index.js';
import { sql } from '../db/client.js';
import { getProvider, resolveProvider, isKeylessPlatform } from '../providers/index.js';
import { decryptForOrg } from '../lib/crypto.js';
import { canMakeRequest, canUseTokens, isOnCooldown } from './ratelimit.js';
import {
  BANDIT_PRESETS, DEFAULT_STRATEGY, type RoutingStrategy, type RoutingWeights,
  reliabilityPosterior, expectedReliability, sampleBeta,
  speedScore, intelligenceScore, headroomFactor, rateLimitFactor, combineScore,
} from './scoring.js';
import { parseBudget } from '../lib/budget.js';
import type { BaseProvider } from '../providers/base.js';

interface KeyRow {
  id: number;
  platform: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  status: string;
  enabled: number;
  base_url: string | null;
}

// Chain row joined with the model fields the bandit needs to score it.
interface ChainRow {
  model_db_id: number;
  priority: number;
  enabled: number;
  platform: string;
  model_id: string;
  display_name: string;
  intelligence_rank: number;
  size_label: string;
  monthly_token_budget: string;
  rpm_limit: number | null;
  rpd_limit: number | null;
  tpm_limit: number | null;
  tpd_limit: number | null;
  supports_vision: number;
  context_window: number | null;
}

export interface RouteResult {
  provider: BaseProvider;
  modelId: string;
  modelDbId: number;
  apiKey: string;
  keyId: number;
  platform: string;
  displayName: string;
  rpdLimit: number | null;
  tpdLimit: number | null;
}

// Round-robin index per platform
const roundRobinIndex = new Map<string, number>();

// ── Dynamic priority: track 429s per model and demote accordingly ──
const rateLimitPenalties = new Map<number, { count: number; lastHit: number; penalty: number }>();

const PENALTY_PER_429 = 3;
const MAX_PENALTY = 10;
const DECAY_INTERVAL_MS = 2 * 60 * 1000;
const DECAY_AMOUNT = 1;

export function recordRateLimitHit(modelDbId: number) {
  const existing = rateLimitPenalties.get(modelDbId);
  const now = Date.now();
  if (existing) {
    existing.count++;
    existing.lastHit = now;
    existing.penalty = Math.min(existing.penalty + PENALTY_PER_429, MAX_PENALTY);
  } else {
    rateLimitPenalties.set(modelDbId, { count: 1, lastHit: now, penalty: PENALTY_PER_429 });
  }
}

export function recordSuccess(modelDbId: number) {
  const existing = rateLimitPenalties.get(modelDbId);
  if (existing) {
    existing.penalty = Math.max(0, existing.penalty - 1);
    if (existing.penalty === 0) rateLimitPenalties.delete(modelDbId);
  }
}

function getPenalty(modelDbId: number): number {
  const entry = rateLimitPenalties.get(modelDbId);
  if (!entry) return 0;
  const now = Date.now();
  const elapsed = now - entry.lastHit;
  const decaySteps = Math.floor(elapsed / DECAY_INTERVAL_MS);
  if (decaySteps > 0) {
    entry.penalty = Math.max(0, entry.penalty - (decaySteps * DECAY_AMOUNT));
    entry.lastHit = now;
    if (entry.penalty === 0) {
      rateLimitPenalties.delete(modelDbId);
      return 0;
    }
  }
  return entry.penalty;
}

export function getAllPenalties(): Array<{ modelDbId: number; count: number; penalty: number }> {
  const result: Array<{ modelDbId: number; count: number; penalty: number }> = [];
  for (const [modelDbId, entry] of rateLimitPenalties) {
    const penalty = getPenalty(modelDbId);
    if (penalty > 0) result.push({ modelDbId, count: entry.count, penalty });
  }
  return result.sort((a, b) => b.penalty - a.penalty);
}

// ── Routing strategy (persisted, per-org) ───────────────────────────────────
const STRATEGY_KEY = 'routing_strategy';
const VALID_STRATEGIES: RoutingStrategy[] = ['priority', 'balanced', 'smartest', 'fastest', 'reliable'];

// Each org picks its own routing strategy; keyed by org in the settings table.
function strategyKey(orgId: number): string {
  return `${STRATEGY_KEY}:${orgId}`;
}

export async function getRoutingStrategy(orgId: number): Promise<RoutingStrategy> {
  const raw = await getSetting(strategyKey(orgId));
  return (raw && VALID_STRATEGIES.includes(raw as RoutingStrategy)) ? (raw as RoutingStrategy) : DEFAULT_STRATEGY;
}

export async function setRoutingStrategy(orgId: number, strategy: RoutingStrategy): Promise<void> {
  if (!VALID_STRATEGIES.includes(strategy)) throw new Error(`Unknown routing strategy: ${strategy}`);
  await setSetting(strategyKey(orgId), strategy);
}

function weightsFor(strategy: RoutingStrategy): RoutingWeights | null {
  return strategy === 'priority' ? null : BANDIT_PRESETS[strategy];
}

// ── Analytics stats cache (decay-weighted) ──────────────────────────────────
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HALF_LIFE_DAYS = 2;
const CACHE_TTL_MS = 60 * 1000;

interface ModelStats {
  successes: number;
  failures: number;
  tokPerSec: number;
  avgTtfbMs: number | null;
  monthlyUsedTokens: number;
}

// Per-org caches: a model's reliability/speed/budget-headroom is derived from
// THAT org's request history only, so one tenant's traffic never influences
// another's routing (and never leaks via the routing scores endpoint).
const statsCacheByOrg = new Map<number, { cache: Map<string, ModelStats>; time: number }>();

function decayWeight(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / HALF_LIFE_DAYS);
}

export async function refreshStatsCache(orgId: number, force = false): Promise<Map<string, ModelStats>> {
  const cached = statsCacheByOrg.get(orgId);
  if (!force && cached && Date.now() - cached.time < CACHE_TTL_MS) return cached.cache;

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const buckets = await sql<Array<{
    platform: string; model_id: string; age_days: number; total: number; successes: number;
    succ_out: number; succ_lat: number; succ_ttfb_sum: number; succ_ttfb_cnt: number;
  }>>`
    SELECT platform, model_id,
      FLOOR(EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS age_days,
      COUNT(*)::int AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS successes,
      SUM(CASE WHEN status = 'success' THEN output_tokens ELSE 0 END)::int AS succ_out,
      SUM(CASE WHEN status = 'success' THEN latency_ms ELSE 0 END)::int AS succ_lat,
      SUM(CASE WHEN status = 'success' AND ttfb_ms IS NOT NULL THEN ttfb_ms ELSE 0 END)::int AS succ_ttfb_sum,
      SUM(CASE WHEN status = 'success' AND ttfb_ms IS NOT NULL THEN 1 ELSE 0 END)::int AS succ_ttfb_cnt
    FROM requests
    WHERE org_id = ${orgId} AND created_at >= ${since}
    GROUP BY platform, model_id, age_days`;

  const acc = new Map<string, { wSucc: number; wFail: number; wOut: number; wLat: number; wTtfbSum: number; wTtfbCnt: number }>();
  for (const b of buckets) {
    const key = `${b.platform}:${b.model_id}`;
    const w = decayWeight(b.age_days);
    const a = acc.get(key) ?? { wSucc: 0, wFail: 0, wOut: 0, wLat: 0, wTtfbSum: 0, wTtfbCnt: 0 };
    a.wSucc += w * b.successes;
    a.wFail += w * (b.total - b.successes);
    a.wOut += w * b.succ_out;
    a.wLat += w * b.succ_lat;
    a.wTtfbSum += w * b.succ_ttfb_sum;
    a.wTtfbCnt += w * b.succ_ttfb_cnt;
    acc.set(key, a);
  }

  const usageRows = await sql<Array<{ platform: string; model_id: string; used: number }>>`
    SELECT platform, model_id, COALESCE(SUM(input_tokens + output_tokens), 0)::int AS used
    FROM requests
    WHERE org_id = ${orgId} AND created_at >= date_trunc('month', now())
    GROUP BY platform, model_id`;
  const usageMap = new Map(usageRows.map(r => [`${r.platform}:${r.model_id}`, r.used]));

  const next = new Map<string, ModelStats>();
  for (const [key, a] of acc) {
    next.set(key, {
      successes: a.wSucc,
      failures: a.wFail,
      tokPerSec: a.wLat > 0 ? (a.wOut * 1000) / a.wLat : 0,
      avgTtfbMs: a.wTtfbCnt > 0 ? a.wTtfbSum / a.wTtfbCnt : null,
      monthlyUsedTokens: usageMap.get(key) ?? 0,
    });
  }
  for (const [key, used] of usageMap) {
    if (!next.has(key)) {
      next.set(key, { successes: 0, failures: 0, tokPerSec: 0, avgTtfbMs: null, monthlyUsedTokens: used });
    }
  }

  statsCacheByOrg.set(orgId, { cache: next, time: Date.now() });
  return next;
}

const TIER_VALUE: Record<string, number> = { Frontier: 4, Large: 3, Medium: 2, Small: 1 };
function intelligenceComposite(sizeLabel: string, intelligenceRank: number): number {
  const tier = TIER_VALUE[sizeLabel] ?? 0;
  return tier * 1000 - intelligenceRank;
}

interface ScoredEntry {
  axes: { reliability: number; speed: number; intelligence: number };
  headroom: number;
  rateLimit: number;
  score: number;
}

function scoreChainEntry(entry: ChainRow, weights: RoutingWeights, intelMin: number, intelMax: number, sampled: boolean, statsMap: Map<string, ModelStats>): ScoredEntry {
  const stats = statsMap.get(`${entry.platform}:${entry.model_id}`);
  const successes = stats?.successes ?? 0;
  const failures = stats?.failures ?? 0;

  let reliability: number;
  if (sampled) {
    const { alpha, beta } = reliabilityPosterior(successes, failures);
    reliability = sampleBeta(alpha, beta);
  } else {
    reliability = expectedReliability(successes, failures);
  }

  const speed = speedScore(stats?.tokPerSec ?? 0, stats?.avgTtfbMs ?? null);
  const intelligence = intelligenceScore(intelligenceComposite(entry.size_label, entry.intelligence_rank), intelMin, intelMax);

  const budget = parseBudget(entry.monthly_token_budget);
  const headroom = headroomFactor(stats?.monthlyUsedTokens ?? 0, budget);
  const rl = rateLimitFactor(getPenalty(entry.model_db_id));

  const score = combineScore({ reliability, speed, intelligence, headroom, rateLimit: rl }, weights);
  return { axes: { reliability, speed, intelligence }, headroom, rateLimit: rl, score };
}

function orderChain(chain: ChainRow[], strategy: RoutingStrategy, statsMap: Map<string, ModelStats>): ChainRow[] {
  const weights = weightsFor(strategy);
  if (!weights) {
    return chain
      .map(e => ({ e, eff: e.priority + getPenalty(e.model_db_id) }))
      .sort((a, b) => a.eff - b.eff || a.e.priority - b.e.priority)
      .map(x => x.e);
  }
  const composites = chain.map(e => intelligenceComposite(e.size_label, e.intelligence_rank));
  const intelMin = composites.length ? Math.min(...composites) : 0;
  const intelMax = composites.length ? Math.max(...composites) : 0;
  return chain
    .map(e => ({ e, s: scoreChainEntry(e, weights, intelMin, intelMax, true, statsMap).score }))
    .sort((a, b) => b.s - a.s || a.e.priority - b.e.priority)
    .map(x => x.e);
}

export async function routeRequest(
  orgId: number,
  estimatedTokens = 1000,
  skipKeys?: Set<string>,
  preferredModelDbId?: number,
  requireVision = false,
): Promise<RouteResult> {
  const strategy = await getRoutingStrategy(orgId);
  const statsMap = strategy !== 'priority' ? await refreshStatsCache(orgId) : new Map<string, ModelStats>();

  // Only this org's fallback chain.
  const chain = await sql<ChainRow[]>`
    SELECT fc.model_db_id, fc.priority, fc.enabled,
           m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.size_label, m.monthly_token_budget,
           m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit, m.supports_vision,
           m.context_window
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id AND m.enabled = 1
    WHERE fc.enabled = 1 AND fc.org_id = ${orgId}`;

  const sortedChain = orderChain([...chain], strategy, statsMap);

  if (preferredModelDbId) {
    const idx = sortedChain.findIndex(e => e.model_db_id === preferredModelDbId);
    if (idx > 0) {
      const [preferred] = sortedChain.splice(idx, 1);
      sortedChain.unshift(preferred);
    }
  }

  for (const entry of sortedChain) {
    if (requireVision && !entry.supports_vision) continue;
    if (entry.context_window != null && estimatedTokens > entry.context_window) continue;

    const provider = getProvider(entry.platform as any);
    if (!provider) continue;

    const keys = await sql<KeyRow[]>`
      SELECT * FROM api_keys
      WHERE platform = ${entry.platform} AND enabled = 1 AND status IN ('healthy', 'unknown') AND org_id = ${orgId}`;

    const limits = { rpm: entry.rpm_limit, rpd: entry.rpd_limit, tpm: entry.tpm_limit, tpd: entry.tpd_limit };

    // Keyless free tier: if the org has no key for an anonymous-capable provider,
    // route it without a key (keyId 0 sentinel) so the free no-key models work as
    // a zero-setup fallback. A real per-org key, when present, takes precedence
    // (the loop below). Keyed providers with no org key are skipped — we never
    // substitute a shared/operator key.
    if (keys.length === 0) {
      if (!isKeylessPlatform(entry.platform)) continue;
      const ANON = 0;
      if (skipKeys?.has(`${entry.platform}:${entry.model_id}:${ANON}`)) continue;
      if (await isOnCooldown(orgId, entry.platform, entry.model_id, ANON)) continue;
      if (!(await canMakeRequest(orgId, entry.platform, entry.model_id, ANON, limits))) continue;
      if (!(await canUseTokens(orgId, entry.platform, entry.model_id, ANON, estimatedTokens, limits))) continue;
      return {
        provider,
        modelId: entry.model_id,
        modelDbId: entry.model_db_id,
        apiKey: '',
        keyId: ANON,
        platform: entry.platform,
        displayName: entry.display_name,
        rpdLimit: limits.rpd,
        tpdLimit: limits.tpd,
      };
    }

    const rrKey = `${entry.platform}:${entry.model_id}`;
    let idx = roundRobinIndex.get(rrKey) ?? 0;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const key = keys[idx % keys.length];
      idx++;

      const skipId = `${entry.platform}:${entry.model_id}:${key.id}`;
      if (skipKeys?.has(skipId)) continue;

      if (await isOnCooldown(orgId, entry.platform, entry.model_id, key.id)) continue;
      if (!(await canMakeRequest(orgId, entry.platform, entry.model_id, key.id, limits))) continue;
      if (!(await canUseTokens(orgId, entry.platform, entry.model_id, key.id, estimatedTokens, limits))) continue;

      let decryptedKey: string;
      try {
        decryptedKey = await decryptForOrg(orgId, key.encrypted_key, key.iv, key.auth_tag);
      } catch {
        await sql`UPDATE api_keys SET status = 'error', last_checked_at = now() WHERE id = ${key.id}`;
        continue;
      }

      const resolvedProvider = entry.platform === 'custom' ? resolveProvider('custom', key.base_url) : provider;
      if (!resolvedProvider) continue;

      roundRobinIndex.set(rrKey, idx);
      return {
        provider: resolvedProvider,
        modelId: entry.model_id,
        modelDbId: entry.model_db_id,
        apiKey: decryptedKey,
        keyId: key.id,
        platform: entry.platform,
        displayName: entry.display_name,
        rpdLimit: limits.rpd,
        tpdLimit: limits.tpd,
      };
    }
    roundRobinIndex.set(rrKey, idx);
  }

  const err = new Error('All models exhausted. Add more API keys or wait for rate limits to reset.') as any;
  err.status = 429;
  throw err;
}

export interface RoutingScore {
  modelDbId: number;
  platform: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  reliability: number;
  speed: number;
  intelligence: number;
  headroom: number;
  rateLimit: number;
  score: number;
  totalRequests: number;
}

export async function getRoutingScores(orgId: number): Promise<{ strategy: RoutingStrategy; weights: RoutingWeights | null; scores: RoutingScore[] }> {
  const strategy = await getRoutingStrategy(orgId);
  const statsMap = await refreshStatsCache(orgId);

  const chain = await sql<ChainRow[]>`
    SELECT fc.model_db_id, fc.priority, fc.enabled,
           m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.size_label, m.monthly_token_budget,
           m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit, m.supports_vision,
           m.context_window
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id
    WHERE m.enabled = 1 AND fc.org_id = ${orgId}`;

  const weights = weightsFor(strategy) ?? BANDIT_PRESETS.balanced;
  const composites = chain.map(e => intelligenceComposite(e.size_label, e.intelligence_rank));
  const intelMin = composites.length ? Math.min(...composites) : 0;
  const intelMax = composites.length ? Math.max(...composites) : 0;

  const scores: RoutingScore[] = chain.map(entry => {
    const scored = scoreChainEntry(entry, weights, intelMin, intelMax, false, statsMap);
    const stats = statsMap.get(`${entry.platform}:${entry.model_id}`);
    return {
      modelDbId: entry.model_db_id,
      platform: entry.platform,
      modelId: entry.model_id,
      displayName: entry.display_name,
      enabled: entry.enabled === 1,
      reliability: scored.axes.reliability,
      speed: scored.axes.speed,
      intelligence: scored.axes.intelligence,
      headroom: scored.headroom,
      rateLimit: scored.rateLimit,
      score: scored.score,
      totalRequests: Math.round((stats?.successes ?? 0) + (stats?.failures ?? 0)),
    };
  }).sort((a, b) => b.score - a.score);

  return { strategy, weights: weightsFor(strategy), scores };
}

export async function hasEnabledVisionModel(orgId: number): Promise<boolean> {
  const [row] = await sql<{ cnt: number }[]>`
    SELECT COUNT(*)::int as cnt
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id
    WHERE fc.enabled = 1 AND fc.org_id = ${orgId} AND m.enabled = 1 AND m.supports_vision = 1`;
  return row.cnt > 0;
}
