import type { Request } from 'express';
import { sql } from '../db/client.js';

// Append-only audit trail (Phase 7). Best-effort: a logging failure must never
// break the action being audited, so everything is wrapped and swallowed.
export async function audit(
  req: Request,
  action: string,
  targetType?: string,
  targetId?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const orgId = req.user?.orgId ?? null;
    const userId = req.user?.userId ?? null;
    const fwd = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress
      || null;
    await sql`
      INSERT INTO audit_log (org_id, user_id, action, target_type, target_id, meta, ip)
      VALUES (${orgId}, ${userId}, ${action}, ${targetType ?? null}, ${targetId ?? null},
              ${meta ? JSON.stringify(meta) : null}::jsonb, ${ip})`;
  } catch (e) {
    console.error('[audit] failed:', (e as Error).message);
  }
}

/** List an org's recent audit entries (for the dashboard / compliance). */
export async function listAudit(orgId: number, limit = 100): Promise<any[]> {
  return await sql<any[]>`
    SELECT id, action, target_type AS "targetType", target_id AS "targetId", meta, ip, created_at AS "createdAt"
    FROM audit_log WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${Math.min(limit, 500)}`;
}
