import type { Request, Response } from 'express';

// Tenant isolation is enforced purely in the app layer (no RLS): every /api/*
// query MUST be scoped to the caller's org. This helper is the single chokepoint
// — call it at the top of each handler and filter every query by the returned id.
//
//   const org = requireOrg(req, res);
//   if (org === null) return;            // 403 already sent
//   ...WHERE org_id = ${org}
//
// Behind requireAuth, req.user is always set; orgId is only null for a legacy
// account with no membership, which we treat as forbidden.
export function requireOrg(req: Request, res: Response): number | null {
  const orgId = req.user?.orgId ?? null;
  if (orgId == null) {
    res.status(403).json({ error: { message: 'No active organization', type: 'forbidden' } });
    return null;
  }
  return orgId;
}
