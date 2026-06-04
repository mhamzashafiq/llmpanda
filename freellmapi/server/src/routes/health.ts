import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from '../db/client.js';
import { checkKeyHealth, checkAllKeys } from '../services/health.js';
import { hasProvider } from '../providers/index.js';
import { requireOrg } from '../lib/tenant.js';

export const healthRouter = Router();

// Get health status for the caller org's keys, grouped by platform
healthRouter.get('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const platforms = await sql<any[]>`
    SELECT
      platform,
      COUNT(*)::int as total_keys,
      SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END)::int as healthy_keys,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END)::int as rate_limited_keys,
      SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END)::int as invalid_keys,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as error_keys,
      SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END)::int as unknown_keys,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END)::int as enabled_keys
    FROM api_keys
    WHERE org_id = ${org}
    GROUP BY platform`;

  const keys = await sql<any[]>`
    SELECT id, platform, label, status, enabled, created_at, last_checked_at
    FROM api_keys
    WHERE org_id = ${org}
    ORDER BY platform, created_at DESC`;

  res.json({
    platforms: platforms.map(p => ({
      platform: p.platform,
      hasProvider: hasProvider(p.platform),
      totalKeys: p.total_keys,
      healthyKeys: p.healthy_keys,
      rateLimitedKeys: p.rate_limited_keys,
      invalidKeys: p.invalid_keys,
      errorKeys: p.error_keys,
      unknownKeys: p.unknown_keys,
      enabledKeys: p.enabled_keys,
    })),
    keys: keys.map(k => ({
      id: k.id,
      platform: k.platform,
      label: k.label,
      status: k.status,
      enabled: k.enabled === 1,
      createdAt: k.created_at,
      lastCheckedAt: k.last_checked_at,
    })),
  });
});

// Check a specific key (must belong to the caller's org)
healthRouter.post('/check/:keyId', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const keyId = parseInt(req.params.keyId as string, 10);
  if (isNaN(keyId)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const status = await checkKeyHealth(keyId, org);
  res.json({ keyId, status });
});

// Check all of the caller org's keys
healthRouter.post('/check-all', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  await checkAllKeys(org);
  res.json({ success: true });
});
