import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from '../db/client.js';
import { hasProvider } from '../providers/index.js';
import { requireOrg } from '../lib/tenant.js';

export const modelsRouter = Router();

// List all models with this org's chain priority + key availability.
modelsRouter.get('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const models = await sql<any[]>`
    SELECT m.*, fc.priority, fc.enabled as fallback_enabled
    FROM models m
    LEFT JOIN fallback_config fc ON fc.model_db_id = m.id AND fc.org_id = ${org}
    ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC`;

  // Count this org's keys per platform
  const keyCounts = await sql<{ platform: string; count: number }[]>`
    SELECT platform, COUNT(*)::int as count
    FROM api_keys
    WHERE enabled = 1 AND org_id = ${org}
    GROUP BY platform`;

  const keyCountMap = new Map(keyCounts.map(k => [k.platform, k.count]));

  const result = models.map(m => ({
    id: m.id,
    platform: m.platform,
    modelId: m.model_id,
    displayName: m.display_name,
    intelligenceRank: m.intelligence_rank,
    speedRank: m.speed_rank,
    sizeLabel: m.size_label,
    rpmLimit: m.rpm_limit,
    rpdLimit: m.rpd_limit,
    tpmLimit: m.tpm_limit,
    tpdLimit: m.tpd_limit,
    monthlyTokenBudget: m.monthly_token_budget,
    contextWindow: m.context_window,
    enabled: m.enabled === 1,
    supportsVision: m.supports_vision === 1,
    priority: m.priority,
    fallbackEnabled: m.fallback_enabled === 1,
    hasProvider: hasProvider(m.platform),
    keyCount: keyCountMap.get(m.platform) ?? 0,
  }));

  res.json(result);
});
