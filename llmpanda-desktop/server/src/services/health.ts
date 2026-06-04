import { sql } from '../db/client.js';
import { resolveProvider } from '../providers/index.js';
import { decryptForOrg } from '../lib/crypto.js';
import type { Platform, KeyStatus } from '@freellmapi/shared/types.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CONSECUTIVE_FAILURES_TO_DISABLE = 3;

// Track consecutive failures per key
const failureCount = new Map<number, number>();

// orgId, when provided (dashboard-triggered checks), restricts the key to that
// tenant so one org can't probe/health-check another org's key. Omitted by the
// background checker, which sweeps every key system-wide.
export async function checkKeyHealth(keyId: number, orgId?: number): Promise<KeyStatus> {
  const [row] = orgId === undefined
    ? await sql<any[]>`SELECT * FROM api_keys WHERE id = ${keyId}`
    : await sql<any[]>`SELECT * FROM api_keys WHERE id = ${keyId} AND org_id = ${orgId}`;
  if (!row) return 'error';

  const provider = resolveProvider(row.platform as Platform, row.base_url);
  if (!provider) return 'error';

  try {
    const apiKey = await decryptForOrg(row.org_id, row.encrypted_key, row.iv, row.auth_tag);
    const isValid = await provider.validateKey(apiKey);

    const status: KeyStatus = isValid ? 'healthy' : 'invalid';

    await sql`UPDATE api_keys SET status = ${status}, last_checked_at = now() WHERE id = ${keyId}`;

    if (isValid) {
      failureCount.delete(keyId);
    } else {
      const count = (failureCount.get(keyId) ?? 0) + 1;
      failureCount.set(keyId, count);

      if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
        await sql`UPDATE api_keys SET enabled = 0 WHERE id = ${keyId}`;
        console.log(`[Health] Auto-disabled key ${keyId} after ${count} consecutive failures`);
      }
    }

    return status;
  } catch (err: any) {
    // Transport errors (DNS/timeout/TLS) — provider unreachable, not necessarily
    // a bad key. Mark status='error' but do NOT increment failure counter — auto-
    // disable is reserved for confirmed 401/403 (returned by validateKey as false).
    console.error(`[Health] Key ${keyId} transport error:`, err.message);
    await sql`UPDATE api_keys SET status = 'error', last_checked_at = now() WHERE id = ${keyId}`;
    return 'error';
  }
}

// orgId scopes the sweep to one tenant (dashboard "Check all"); omitted by the
// background checker to sweep every enabled key across all orgs.
export async function checkAllKeys(orgId?: number): Promise<void> {
  const keys = orgId === undefined
    ? await sql<{ id: number; platform: string }[]>`SELECT id, platform FROM api_keys WHERE enabled = 1`
    : await sql<{ id: number; platform: string }[]>`SELECT id, platform FROM api_keys WHERE enabled = 1 AND org_id = ${orgId}`;

  console.log(`[Health] Checking ${keys.length} keys${orgId === undefined ? '' : ` (org ${orgId})`}...`);

  for (const key of keys) {
    await checkKeyHealth(key.id, orgId);
  }

  console.log(`[Health] Check complete.`);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startHealthChecker(): void {
  if (intervalId) return;
  console.log(`[Health] Starting health checker (every ${CHECK_INTERVAL_MS / 1000}s)`);
  intervalId = setInterval(() => {
    checkAllKeys().catch(err => console.error('[Health] Check failed:', err));
  }, CHECK_INTERVAL_MS);
}

export function stopHealthChecker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
