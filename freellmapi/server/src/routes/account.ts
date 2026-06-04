import { Router } from 'express';
import type { Request, Response } from 'express';
import { sql } from '../db/client.js';
import { requireOrg } from '../lib/tenant.js';
import { audit, listAudit } from '../services/audit.js';
import { maskKey, decryptForOrg } from '../lib/crypto.js';

// Phase 7: account self-service — audit trail, GDPR data export, GDPR erasure.
export const accountRouter = Router();

// Desktop/local single-user mode (set by the Electron shell). Hosted = false.
const LOCAL_MODE = process.env.LOCAL_MODE === '1';

// Full local-database backup (desktop only): a single JSON file with every row
// of every table — the user's complete dataset. Provider keys are included
// still-encrypted, so a restore needs the local encryption.key too. Guarded to
// LOCAL_MODE so it never dumps the hosted multi-tenant database.
accountRouter.get('/backup', async (_req: Request, res: Response) => {
  if (!LOCAL_MODE) {
    res.status(404).json({ error: { message: 'Full backup is only available in the desktop app.' } });
    return;
  }
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const dump: Record<string, unknown[]> = {};
  for (const { tablename } of tables) {
    dump[tablename] = await sql.unsafe(`SELECT * FROM "${tablename}"`);
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="llmpanda-backup-${stamp}.json"`);
  res.json({ version: 1, exportedAt: new Date().toISOString(), tables: dump });
});

// Recent audit-log entries for the org.
accountRouter.get('/audit', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  res.json(await listAudit(org));
});

// GDPR data-portability export: everything we hold for this org, as JSON.
accountRouter.get('/export', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;

  const [organization] = await sql<any[]>`
    SELECT id, name, plan, plan_status, created_at FROM organizations WHERE id = ${org}`;
  const members = await sql<any[]>`
    SELECT m.role, m.created_at, u.email, u.full_name
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${org}`;
  const keyRows = await sql<any[]>`SELECT id, platform, label, encrypted_key, iv, auth_tag, status, created_at FROM api_keys WHERE org_id = ${org}`;
  const providerKeys = await Promise.all(keyRows.map(async k => {
    let masked = '****';
    try { masked = maskKey(await decryptForOrg(org, k.encrypted_key, k.iv, k.auth_tag)); } catch { masked = '[decrypt failed]'; }
    return { id: k.id, platform: k.platform, label: k.label, maskedKey: masked, status: k.status, createdAt: k.created_at };
  }));
  const clientKeys = await sql<any[]>`SELECT id, name, key_prefix, last_used_at, revoked_at, created_at FROM api_clients WHERE org_id = ${org}`;
  const fallback = await sql<any[]>`
    SELECT m.platform, m.model_id, fc.priority, fc.enabled
    FROM fallback_config fc JOIN models m ON m.id = fc.model_db_id WHERE fc.org_id = ${org} ORDER BY fc.priority`;
  const leads = await sql<any[]>`SELECT email, full_name, company, role, team_size, use_case, created_at FROM leads WHERE org_id = ${org}`;
  const recentRequests = await sql<any[]>`
    SELECT platform, model_id, status, input_tokens, output_tokens, latency_ms, created_at
    FROM requests WHERE org_id = ${org} ORDER BY created_at DESC LIMIT 1000`;
  const auditTrail = await listAudit(org, 500);

  await audit(req, 'account.export', 'organization', String(org));
  res.setHeader('Content-Disposition', `attachment; filename="llmpanda-export-org-${org}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    organization, members, providerKeys, clientKeys, fallback, leads,
    recentRequests, auditTrail,
  });
});

// GDPR erasure: permanently delete the org and all its data. Owner-only, requires
// an explicit confirmation. IRREVERSIBLE.
accountRouter.delete('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;

  const [membership] = await sql<{ role: string }[]>`
    SELECT role FROM memberships WHERE org_id = ${org} AND user_id = ${req.user!.userId}`;
  if (membership?.role !== 'owner') {
    res.status(403).json({ error: { message: 'Only the organization owner can delete the account' } });
    return;
  }
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: { message: 'Confirmation required: send { "confirm": true }' } });
    return;
  }

  // Log the erasure BEFORE wiping (the org's own audit rows are about to go).
  console.log(`[gdpr] erasing org ${org} requested by user ${req.user!.userId}`);

  await sql.begin(async tx => {
    await tx`DELETE FROM requests WHERE org_id = ${org}`;
    await tx`DELETE FROM rate_limit_usage WHERE org_id = ${org}`;
    await tx`DELETE FROM rate_limit_cooldowns WHERE org_id = ${org}`;
    await tx`DELETE FROM fallback_config WHERE org_id = ${org}`;
    await tx`DELETE FROM api_keys WHERE org_id = ${org}`;
    await tx`DELETE FROM api_clients WHERE org_id = ${org}`;
    await tx`DELETE FROM audit_log WHERE org_id = ${org}`;
    await tx`DELETE FROM leads WHERE org_id = ${org}`;
    await tx`DELETE FROM billing_events WHERE org_id = ${org}`;
    // Members of this org.
    const memberIds = await tx<{ user_id: number }[]>`SELECT user_id FROM memberships WHERE org_id = ${org}`;
    await tx`DELETE FROM memberships WHERE org_id = ${org}`;
    await tx`DELETE FROM organizations WHERE id = ${org}`;
    // Orphan users (no remaining membership) + their sessions.
    for (const m of memberIds) {
      const [stillMember] = await tx`SELECT 1 FROM memberships WHERE user_id = ${m.user_id} LIMIT 1`;
      if (!stillMember) {
        await tx`DELETE FROM sessions WHERE user_id = ${m.user_id}`;
        await tx`DELETE FROM users WHERE id = ${m.user_id}`;
      }
    }
  });

  res.json({ success: true, erased: true });
});
