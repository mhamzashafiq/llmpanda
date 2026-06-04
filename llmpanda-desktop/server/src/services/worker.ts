import { PgBoss } from 'pg-boss';
import { connectionString, sql } from '../db/client.js';
import { checkAllKeys } from './health.js';

// Phase 4: background jobs on a Postgres-backed queue (pg-boss). Moves health
// checks + housekeeping OUT of the request path and makes them multi-instance
// safe — pg-boss ensures a scheduled job runs on only one instance at a time.

const HEALTH_QUEUE = 'health-check';
const HOUSEKEEPING_QUEUE = 'housekeeping';

let boss: PgBoss | null = null;

export async function startWorkers(): Promise<void> {
  if (boss) return;
  boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err: Error) => console.error('[worker] pg-boss error:', err.message));
  await boss.start();

  await boss.createQueue(HEALTH_QUEUE);
  await boss.createQueue(HOUSEKEEPING_QUEUE);

  // System-wide provider-key health sweep (all orgs).
  await boss.work(HEALTH_QUEUE, async () => { await checkAllKeys(); });

  // Prune expired cooldowns + ledger rows older than the daily window.
  await boss.work(HOUSEKEEPING_QUEUE, async () => {
    const now = Date.now();
    await sql`DELETE FROM rate_limit_cooldowns WHERE expires_at_ms < ${now}`;
    await sql`DELETE FROM rate_limit_usage WHERE created_at_ms < ${now - 25 * 60 * 60 * 1000}`;
  });

  // Recurring schedules (cron). pg-boss dedupes across instances.
  await boss.schedule(HEALTH_QUEUE, '*/5 * * * *');
  await boss.schedule(HOUSEKEEPING_QUEUE, '*/30 * * * *');

  console.log('[worker] pg-boss started (health-check every 5m, housekeeping every 30m)');
}

export async function stopWorkers(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}
