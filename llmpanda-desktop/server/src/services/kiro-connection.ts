import { sql } from '../db/client.js';
import { decryptForOrg, encryptForOrg } from '../lib/crypto.js';
import { refreshKiroToken } from '../lib/oauth/kiro.js';

// Resolve a usable Kiro access token for an org from its enabled OAuth connection
// (provider_connections). Refreshes + persists the token when it's expired/near
// expiry. Returns null if the org has no enabled Kiro connection — the router
// then skips Kiro entirely (so non-connected orgs are unaffected).
export async function getKiroAccessToken(orgId: number): Promise<{ token: string; connId: number } | null> {
  const rows = await sql<{ id: number; secret_enc: string; secret_iv: string; secret_tag: string; expires_at: string | null }[]>`
    SELECT id, secret_enc, secret_iv, secret_tag, expires_at FROM provider_connections
    WHERE org_id = ${orgId} AND provider = 'kiro' AND enabled = 1
    ORDER BY created_at DESC LIMIT 1`;
  if (!rows[0]) return null;
  const r = rows[0];

  let secret: Record<string, any>;
  try {
    secret = JSON.parse(await decryptForOrg(orgId, r.secret_enc, r.secret_iv, r.secret_tag));
  } catch {
    return null;
  }

  const exp = r.expires_at ? new Date(r.expires_at).getTime() : 0;
  const nearExpiry = exp > 0 && exp < Date.now() + 60_000;
  if (nearExpiry && secret.refreshToken && secret.clientId && secret.clientSecret) {
    try {
      const t = await refreshKiroToken(secret.clientId, secret.clientSecret, secret.refreshToken, secret.region || 'us-east-1');
      secret = { ...secret, accessToken: t.accessToken, refreshToken: t.refreshToken };
      const sealed = await encryptForOrg(orgId, JSON.stringify(secret));
      const newExp = t.expiresIn ? new Date(Date.now() + t.expiresIn * 1000) : null;
      await sql`UPDATE provider_connections SET secret_enc = ${sealed.encrypted}, secret_iv = ${sealed.iv}, secret_tag = ${sealed.authTag}, expires_at = ${newExp} WHERE id = ${r.id}`;
    } catch {
      // Refresh failed — fall back to the stale token; the call will 403 and the
      // proxy's retry/cooldown handles it.
    }
  }

  return secret.accessToken ? { token: secret.accessToken as string, connId: r.id } : null;
}
