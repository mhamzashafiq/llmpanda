import { sql } from '../db/client.js';
import type { SessionUser } from '../services/auth.js';

// Desktop / local single-user mode. When LOCAL_MODE=1 the app runs with NO
// login: a single local user + org is provisioned at boot (see initDb), every
// /api request is bound to it, and /api/auth/status reports "authenticated".
// There is no external database or account — everything is on the user's machine.
export const LOCAL_MODE = process.env.LOCAL_MODE === '1';

let cached: SessionUser | null = null;

/** The one local operator's session (provisioned in initDb). Cached after first read. */
export async function getLocalSession(): Promise<SessionUser> {
  if (cached) return cached;
  const [u] = await sql<{ id: number; email: string; org_id: number | null }[]>`
    SELECT u.id, u.email,
           (SELECT org_id FROM memberships WHERE user_id = u.id ORDER BY id LIMIT 1) AS org_id
    FROM users u ORDER BY u.id LIMIT 1`;
  if (!u || u.org_id == null) throw new Error('LOCAL_MODE: no local user provisioned');
  cached = { userId: u.id, email: u.email, orgId: u.org_id };
  return cached;
}
