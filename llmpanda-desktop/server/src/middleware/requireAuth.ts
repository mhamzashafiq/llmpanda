import type { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/auth.js';
import { LOCAL_MODE, getLocalSession } from '../lib/localMode.js';

// Gate the /api/* admin surface behind a dashboard session (#35, item #2).
// The token is the opaque session token issued by /api/auth/login|setup, sent
// as `Authorization: Bearer <token>`. The /v1 proxy is NOT gated by this — it
// keeps its own unified-API-key auth for app clients.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Desktop/local mode: no accounts — every request is the single local operator.
  if (LOCAL_MODE) {
    (req as Request & { user?: unknown }).user = await getLocalSession();
    next();
    return;
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    ?? (req.headers['x-dashboard-token'] as string | undefined);
  const session = await validateSession(token);
  if (!session) {
    res.status(401).json({ error: { message: 'Authentication required', type: 'authentication_error' } });
    return;
  }
  (req as Request & { user?: typeof session }).user = session;
  next();
}
