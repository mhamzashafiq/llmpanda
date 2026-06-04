import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  getUnifiedApiKey, regenerateUnifiedKey,
  listClientKeys, createClientKey, revokeClientKey,
} from '../db/index.js';
import { requireOrg } from '../lib/tenant.js';
import { audit } from '../services/audit.js';

export const settingsRouter = Router();

// Get the caller org's unified API key
settingsRouter.get('/api-key', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  res.json({ apiKey: await getUnifiedApiKey(org) });
});

// Regenerate the caller org's unified API key
settingsRouter.post('/api-key/regenerate', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const newKey = await regenerateUnifiedKey(org);
  await audit(req, 'api_key.regenerate', 'organization', String(org));
  res.json({ apiKey: newKey });
});

// ── Phase 3: client API keys (multiple, named, revocable) ────────────────────
settingsRouter.get('/clients', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  res.json(await listClientKeys(org));
});

const createClientSchema = z.object({ name: z.string().trim().max(80).optional() });

settingsRouter.post('/clients', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const parsed = createClientSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const created = await createClientKey(org, parsed.data.name ?? 'Untitled');
  await audit(req, 'client_key.create', 'api_client', String(created.id), { name: created.name });
  // Plaintext returned ONCE — the client must copy it now.
  res.status(201).json(created);
});

settingsRouter.delete('/clients/:id', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid client id' } });
    return;
  }
  const ok = await revokeClientKey(org, id);
  if (!ok) {
    res.status(404).json({ error: { message: 'Client key not found' } });
    return;
  }
  await audit(req, 'client_key.revoke', 'api_client', String(id));
  res.json({ success: true });
});
