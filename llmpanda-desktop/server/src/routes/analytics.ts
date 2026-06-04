import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from '../db/client.js';
import { requireOrg } from '../lib/tenant.js';

export const analyticsRouter = Router();

// Rolling cutoff as an ISO string; PG casts it to timestamptz in comparisons.
function getSince(range: string): string {
  const now = Date.now();
  const ms = range === '24h' ? 24 * 60 * 60 * 1000
    : range === '30d' ? 30 * 24 * 60 * 60 * 1000
    : 7 * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

// Summary stats
analyticsRouter.get('/summary', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const since = getSince((req.query.range as string) ?? '7d');
  const [stats] = await sql<any[]>`
    SELECT
      COUNT(*)::int as total_requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int as success_count,
      COALESCE(SUM(input_tokens), 0)::int as total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::int as total_output_tokens,
      COALESCE(AVG(latency_ms), 0)::float as avg_latency_ms
    FROM requests
    WHERE org_id = ${org} AND created_at >= ${since}`;

  const totalRequests = stats.total_requests ?? 0;
  const successRate = totalRequests > 0 ? (stats.success_count / totalRequests) * 100 : 0;
  const inputCost = ((stats.total_input_tokens ?? 0) / 1_000_000) * 3;
  const outputCost = ((stats.total_output_tokens ?? 0) / 1_000_000) * 15;

  res.json({
    totalRequests,
    successRate: Math.round(successRate * 10) / 10,
    totalInputTokens: stats.total_input_tokens ?? 0,
    totalOutputTokens: stats.total_output_tokens ?? 0,
    avgLatencyMs: Math.round(stats.avg_latency_ms ?? 0),
    estimatedCostSavings: Math.round((inputCost + outputCost) * 100) / 100,
  });
});

// Stats grouped by model
analyticsRouter.get('/by-model', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const since = getSince((req.query.range as string) ?? '7d');
  const rows = await sql<any[]>`
    SELECT
      r.platform, r.model_id, m.display_name,
      COUNT(*)::int as requests,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(r.latency_ms)::float as avg_latency_ms,
      COALESCE(SUM(r.input_tokens), 0)::int as total_input_tokens,
      COALESCE(SUM(r.output_tokens), 0)::int as total_output_tokens
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    WHERE r.org_id = ${org} AND r.created_at >= ${since}
    GROUP BY r.platform, r.model_id, m.display_name
    ORDER BY requests DESC`;

  res.json(rows.map(r => ({
    platform: r.platform,
    modelId: r.model_id,
    displayName: r.display_name ?? r.model_id,
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

// Stats grouped by platform
analyticsRouter.get('/by-platform', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const since = getSince((req.query.range as string) ?? '7d');
  const rows = await sql<any[]>`
    SELECT
      platform,
      COUNT(*)::int as requests,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(latency_ms)::float as avg_latency_ms,
      COALESCE(SUM(input_tokens), 0)::int as total_input_tokens,
      COALESCE(SUM(output_tokens), 0)::int as total_output_tokens
    FROM requests
    WHERE org_id = ${org} AND created_at >= ${since}
    GROUP BY platform
    ORDER BY requests DESC`;

  res.json(rows.map(r => ({
    platform: r.platform,
    requests: r.requests,
    successRate: Math.round(r.success_rate * 10) / 10,
    avgLatencyMs: Math.round(r.avg_latency_ms),
    totalInputTokens: r.total_input_tokens ?? 0,
    totalOutputTokens: r.total_output_tokens ?? 0,
  })));
});

// Stats grouped by provider key. key_id 0 = keyless (anonymous free tier).
// Joins api_keys for the label/platform; rows whose key was since deleted still
// show (labelled by id) so historical usage isn't lost.
analyticsRouter.get('/by-key', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const since = getSince((req.query.range as string) ?? '7d');
  const rows = await sql<any[]>`
    SELECT
      r.key_id,
      k.label AS key_label,
      k.platform AS key_platform,
      k.status AS key_status,
      COUNT(*)::int as requests,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate,
      AVG(r.latency_ms)::float as avg_latency_ms,
      COALESCE(SUM(r.input_tokens), 0)::int as total_input_tokens,
      COALESCE(SUM(r.output_tokens), 0)::int as total_output_tokens
    FROM requests r
    LEFT JOIN api_keys k ON k.id = r.key_id AND k.org_id = ${org}
    WHERE r.org_id = ${org} AND r.created_at >= ${since}
    GROUP BY r.key_id, k.label, k.platform, k.status
    ORDER BY requests DESC`;

  res.json(rows.map(r => {
    const keyless = r.key_id === 0 || r.key_id === null;
    return {
      keyId: r.key_id,
      label: keyless ? 'Keyless (anonymous)' : (r.key_label || `Key #${r.key_id}`),
      platform: r.key_platform ?? (keyless ? 'free tier' : 'deleted'),
      status: keyless ? 'keyless' : (r.key_status ?? 'deleted'),
      keyless,
      requests: r.requests,
      successRate: Math.round(r.success_rate * 10) / 10,
      avgLatencyMs: Math.round(r.avg_latency_ms),
      totalInputTokens: r.total_input_tokens ?? 0,
      totalOutputTokens: r.total_output_tokens ?? 0,
    };
  }));
});

// Timeline data
analyticsRouter.get('/timeline', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const range = (req.query.range as string) ?? '7d';
  const interval = (req.query.interval as string) ?? (range === '24h' ? 'hour' : 'day');
  const since = getSince(range);

  const rows = interval === 'hour'
    ? await sql<any[]>`
        SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:00:00') as timestamp,
          COUNT(*)::int as requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int as success_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as failure_count
        FROM requests WHERE org_id = ${org} AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1 ASC`
    : await sql<any[]>`
        SELECT to_char(created_at, 'YYYY-MM-DD') as timestamp,
          COUNT(*)::int as requests,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int as success_count,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int as failure_count
        FROM requests WHERE org_id = ${org} AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1 ASC`;

  res.json(rows.map(r => ({
    timestamp: r.timestamp,
    requests: r.requests,
    successCount: r.success_count,
    failureCount: r.failure_count,
  })));
});

// Error distribution
analyticsRouter.get('/error-distribution', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const since = getSince((req.query.range as string) ?? '7d');
  const category = sql`
    CASE
      WHEN error LIKE '%429%' OR error LIKE '%rate limit%' OR error LIKE '%too many%' OR error LIKE '%quota%' THEN 'Rate Limited (429)'
      WHEN error LIKE '%401%' OR error LIKE '%unauthorized%' THEN 'Auth Error (401)'
      WHEN error LIKE '%403%' OR error LIKE '%forbidden%' THEN 'Forbidden (403)'
      WHEN error LIKE '%404%' OR error LIKE '%not found%' THEN 'Not Found (404)'
      WHEN error LIKE '%timeout%' OR error LIKE '%ETIMEDOUT%' OR error LIKE '%ECONNREFUSED%' THEN 'Timeout/Connection'
      WHEN error LIKE '%500%' OR error LIKE '%internal server%' THEN 'Server Error (500)'
      WHEN error LIKE '%503%' OR error LIKE '%unavailable%' THEN 'Unavailable (503)'
      ELSE 'Other'
    END`;

  const rows = await sql<any[]>`
    SELECT platform, ${category} as error_category, COUNT(*)::int as count
    FROM requests WHERE org_id = ${org} AND status = 'error' AND created_at >= ${since}
    GROUP BY platform, error_category ORDER BY count DESC`;
  const byCategory = await sql<any[]>`
    SELECT ${category} as category, COUNT(*)::int as count
    FROM requests WHERE org_id = ${org} AND status = 'error' AND created_at >= ${since}
    GROUP BY category ORDER BY count DESC`;
  const byPlatform = await sql<any[]>`
    SELECT platform, COUNT(*)::int as count
    FROM requests WHERE org_id = ${org} AND status = 'error' AND created_at >= ${since}
    GROUP BY platform ORDER BY count DESC`;

  res.json({ byCategory, byPlatform, detailed: rows });
});

// Recent requests (all statuses) — powers the Request Log / inspector page.
analyticsRouter.get('/requests', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const since = getSince((req.query.range as string) ?? '7d');
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const statusParam = req.query.status as string | undefined;
  const wantStatus = statusParam === 'success' || statusParam === 'error' ? statusParam : null;

  const rows = await sql<any[]>`
    SELECT
      r.id, r.platform, r.model_id, r.key_id, r.status,
      r.input_tokens, r.output_tokens, r.latency_ms, r.ttfb_ms, r.error, r.created_at,
      r.prompt, r.response,
      m.display_name
    FROM requests r
    LEFT JOIN models m ON m.platform = r.platform AND m.model_id = r.model_id
    WHERE r.org_id = ${org} AND r.created_at >= ${since} ${wantStatus ? sql`AND r.status = ${wantStatus}` : sql``}
    ORDER BY r.created_at DESC
    LIMIT ${limit}`;

  res.json(rows.map(r => ({
    id: r.id,
    platform: r.platform,
    modelId: r.model_id,
    displayName: r.display_name ?? r.model_id,
    keyId: r.key_id,
    status: r.status,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    latencyMs: r.latency_ms ?? 0,
    ttfbMs: r.ttfb_ms,
    error: r.error,
    prompt: r.prompt,
    response: r.response,
    createdAt: r.created_at,
  })));
});

// Recent errors
analyticsRouter.get('/errors', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const since = getSince((req.query.range as string) ?? '7d');
  const rows = await sql<any[]>`
    SELECT id, platform, model_id, error, latency_ms, created_at
    FROM requests
    WHERE org_id = ${org} AND status = 'error' AND created_at >= ${since}
    ORDER BY created_at DESC
    LIMIT 50`;

  res.json(rows.map(r => ({
    id: r.id,
    platform: r.platform,
    modelId: r.model_id,
    error: r.error,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  })));
});
