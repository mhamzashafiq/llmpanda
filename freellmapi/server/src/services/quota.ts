import { sql } from '../db/client.js';
import { planLimits } from '../lib/plans.js';

// Phase 4: per-org monthly request quota, enforced at the proxy. The month count
// is cached for 60s per org (a COUNT on every /v1 call would add latency) and
// nudged up by bumpQuota after each accepted request so we don't overshoot the
// cap within a cache window.
const TTL_MS = 60_000;
const cache = new Map<number, { used: number; plan: string; time: number }>();

export interface QuotaState {
  allowed: boolean;
  used: number;
  limit: number | null;
  plan: string;
}

export async function checkQuota(orgId: number): Promise<QuotaState> {
  const now = Date.now();
  let c = cache.get(orgId);
  if (!c || now - c.time > TTL_MS) {
    const [org] = await sql<{ plan: string }[]>`SELECT plan FROM organizations WHERE id = ${orgId}`;
    const [u] = await sql<{ used: number }[]>`
      SELECT COUNT(*)::int AS used FROM requests
      WHERE org_id = ${orgId} AND created_at >= date_trunc('month', now())`;
    c = { used: u?.used ?? 0, plan: org?.plan ?? 'free', time: now };
    cache.set(orgId, c);
  }
  const limit = planLimits(c.plan).monthlyRequests;
  return { allowed: limit === null || c.used < limit, used: c.used, limit, plan: c.plan };
}

export function bumpQuota(orgId: number): void {
  const c = cache.get(orgId);
  if (c) c.used += 1;
}
