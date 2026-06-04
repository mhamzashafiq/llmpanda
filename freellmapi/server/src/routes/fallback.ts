import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { getAllPenalties, getRoutingScores, getRoutingStrategy, setRoutingStrategy } from '../services/router.js';
import { BANDIT_PRESETS, type RoutingStrategy } from '../services/scoring.js';
import { parseBudget } from '../lib/budget.js';
import { getRateLimitStatus } from '../services/ratelimit.js';
import { requireOrg } from '../lib/tenant.js';

export const fallbackRouter = Router();

// ── Bandit routing strategy ─────────────────────────────────────────────────
fallbackRouter.get('/routing', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  res.json(await getRoutingScores(org));
});

const routingSchema = z.object({
  strategy: z.enum(['priority', 'balanced', 'smartest', 'fastest', 'reliable']),
});

fallbackRouter.put('/routing', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const parsed = routingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  await setRoutingStrategy(org, parsed.data.strategy as RoutingStrategy);
  res.json({ strategy: await getRoutingStrategy(org), presets: BANDIT_PRESETS });
});

// Get fallback chain (with dynamic penalties)
fallbackRouter.get('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const rows = await sql<any[]>`
    SELECT fc.model_db_id, fc.priority, fc.enabled,
           m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.speed_rank, m.size_label, m.rpm_limit, m.rpd_limit,
           m.monthly_token_budget, m.supports_vision
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id
    WHERE fc.org_id = ${org}
    ORDER BY fc.priority ASC`;

  const keyCounts = await sql<{ platform: string; count: number }[]>`
    SELECT platform, COUNT(*)::int as count FROM api_keys WHERE enabled = 1 AND org_id = ${org} GROUP BY platform`;
  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));

  const penalties = getAllPenalties();
  const penaltyMap = new Map(penalties.map(p => [p.modelDbId, p]));

  res.json(rows.map(r => {
    const penalty = penaltyMap.get(r.model_db_id);
    return {
      modelDbId: r.model_db_id,
      priority: r.priority,
      effectivePriority: r.priority + (penalty?.penalty ?? 0),
      penalty: penalty?.penalty ?? 0,
      rateLimitHits: penalty?.count ?? 0,
      enabled: r.enabled === 1,
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name,
      intelligenceRank: r.intelligence_rank,
      speedRank: r.speed_rank,
      sizeLabel: r.size_label,
      rpmLimit: r.rpm_limit,
      rpdLimit: r.rpd_limit,
      monthlyTokenBudget: r.monthly_token_budget,
      supportsVision: r.supports_vision === 1,
      keyCount: keyCountMap.get(r.platform) ?? 0,
    };
  }));
});

const updateSchema = z.array(z.object({
  modelDbId: z.number(),
  priority: z.number(),
  enabled: z.boolean(),
}));

// Update fallback chain (full replace) — scoped to the caller's org
fallbackRouter.put('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  await sql.begin(async tx => {
    for (const entry of parsed.data) {
      await tx`UPDATE fallback_config SET priority = ${entry.priority}, enabled = ${entry.enabled ? 1 : 0} WHERE model_db_id = ${entry.modelDbId} AND org_id = ${org}`;
    }
  });
  res.json({ success: true });
});

const INTELLIGENCE_TIER =
  "CASE m.size_label WHEN 'Frontier' THEN 1 WHEN 'Large' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Small' THEN 4 ELSE 5 END";

const SORT_PRESETS: Record<string, string> = {
  intelligence: `${INTELLIGENCE_TIER} ASC, m.intelligence_rank ASC`,
  speed: 'm.speed_rank ASC',
  budget: "CASE m.monthly_token_budget WHEN '~120M' THEN 1 WHEN '~50-100M' THEN 2 WHEN '~30M' THEN 3 WHEN '~18-45M' THEN 4 WHEN '~18M' THEN 5 WHEN '~15M' THEN 6 WHEN '~12M' THEN 7 WHEN '~6M' THEN 8 WHEN '~5-10M' THEN 9 WHEN '~4M' THEN 10 ELSE 11 END ASC",
};

fallbackRouter.post('/sort/:preset', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const preset = String(req.params.preset);
  const orderBy = SORT_PRESETS[preset];
  if (!orderBy) {
    res.status(400).json({ error: { message: `Unknown preset: ${preset}. Use: intelligence, speed, budget` } });
    return;
  }
  // orderBy is from a fixed whitelist — safe to interpolate.
  const models = await sql.unsafe(`SELECT m.id FROM models m ORDER BY ${orderBy}`) as unknown as { id: number }[];
  await sql.begin(async tx => {
    for (let i = 0; i < models.length; i++) {
      await tx`UPDATE fallback_config SET priority = ${i + 1} WHERE model_db_id = ${models[i].id} AND org_id = ${org}`;
    }
  });
  res.json({ success: true, preset });
});

interface TokenUsageData {
  totalBudget: number;
  totalUsed: number;
  models: { displayName: string; platform: string; budget: number }[];
}

// Token usage per model for the stacked bar
fallbackRouter.get('/token-usage', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const platforms = await sql<{ platform: string }[]>`SELECT DISTINCT platform FROM api_keys WHERE enabled = 1 AND org_id = ${org}`;
  const platformSet = new Set(platforms.map(p => p.platform));

  const models = await sql<{ platform: string; model_id: string; display_name: string; monthly_token_budget: string; priority: number }[]>`
    SELECT m.platform, m.model_id, m.display_name, m.monthly_token_budget, fc.priority
    FROM models m
    JOIN fallback_config fc ON fc.model_db_id = m.id
    WHERE m.enabled = 1 AND fc.org_id = ${org}
    ORDER BY fc.priority ASC`;

  const modelBudgets = models
    .filter(m => platformSet.has(m.platform))
    .map(m => ({ displayName: m.display_name, platform: m.platform, budget: parseBudget(m.monthly_token_budget) }));
  const totalBudget = modelBudgets.reduce((s, m) => s + m.budget, 0);

  const [usage] = await sql<{ total_used: number }[]>`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::int as total_used
    FROM requests WHERE org_id = ${org} AND created_at >= date_trunc('month', now())`;

  const out: TokenUsageData = { totalBudget, totalUsed: usage.total_used, models: modelBudgets };
  res.json(out);
});

// Live rate-limit usage per (model × key) — powers the usage gauges.
fallbackRouter.get('/usage', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const models = await sql<any[]>`
    SELECT m.platform, m.model_id, m.display_name, m.rpm_limit, m.rpd_limit, m.tpm_limit, m.tpd_limit
    FROM models m
    JOIN fallback_config fc ON fc.model_db_id = m.id
    WHERE m.enabled = 1 AND fc.enabled = 1 AND fc.org_id = ${org}
    ORDER BY fc.priority ASC`;
  const keys = await sql<{ id: number; platform: string; label: string | null }[]>`
    SELECT id, platform, label FROM api_keys WHERE enabled = 1 AND org_id = ${org}`;

  const out: any[] = [];
  for (const m of models) {
    for (const k of keys.filter(k => k.platform === m.platform)) {
      const status = await getRateLimitStatus(org, m.platform, m.model_id, k.id, {
        rpm: m.rpm_limit, rpd: m.rpd_limit, tpm: m.tpm_limit, tpd: m.tpd_limit,
      });
      const active = status.rpm.limit !== null || status.rpd.limit !== null || status.tpm.limit !== null ||
        status.rpm.used > 0 || status.rpd.used > 0 || status.tpm.used > 0;
      if (!active) continue;
      out.push({
        platform: m.platform, modelId: m.model_id, displayName: m.display_name,
        keyId: k.id, keyLabel: k.label || `Key #${k.id}`,
        rpm: status.rpm, rpd: status.rpd, tpm: status.tpm,
      });
    }
  }
  res.json(out);
});
