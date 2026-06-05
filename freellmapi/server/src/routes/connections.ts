import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireOrg } from '../lib/tenant.js';
import { audit } from '../services/audit.js';
import {
  listProviderConnections, saveProviderConnection, deleteProviderConnection, setProviderConnectionEnabled,
} from '../db/index.js';
import { registerClient, startDeviceAuthorization, pollDeviceToken, KIRO_CONFIG } from '../lib/oauth/kiro.js';

export const connectionsRouter = Router();

// ⚠️ These connect a user's account on another service (Kiro/AWS, etc.) and proxy
// it — which may violate that service's ToS (account ban / legal risk). Opt-in,
// OFF by default. Only the OAuth + storage half lives here; the CodeWhisperer
// chat adapter is built separately and the connection does not route until then.

// In-memory pending device-auth sessions (single-instance prod). authId → creds.
interface Pending { orgId: number; clientId: string; clientSecret: string; deviceCode: string; region: string; authType: string; startUrl: string; expiresAt: number }
const pending = new Map<string, Pending>();
function prune() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
}

// List the org's connections (metadata only).
connectionsRouter.get('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  res.json(await listProviderConnections(org));
});

// Begin a Kiro AWS-SSO device-code flow. Returns the user code + verification URL.
const startSchema = z.object({ region: z.string().max(40).optional(), startUrl: z.string().url().optional() });
connectionsRouter.post('/kiro/start', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const parsed = startSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: { message: 'Invalid request' } }); return; }
  const region = parsed.data.region ?? 'us-east-1';
  const startUrl = parsed.data.startUrl ?? KIRO_CONFIG.startUrl;
  try {
    const client = await registerClient(region);
    const device = await startDeviceAuthorization(client.clientId, client.clientSecret, startUrl, region);
    prune();
    const authId = crypto.randomBytes(18).toString('hex');
    pending.set(authId, {
      orgId: org, clientId: client.clientId, clientSecret: client.clientSecret,
      deviceCode: device.deviceCode, region, authType: 'builder-id', startUrl,
      expiresAt: Date.now() + device.expiresIn * 1000,
    });
    res.json({
      authId,
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
      interval: device.interval,
      expiresIn: device.expiresIn,
    });
  } catch (err: any) {
    res.status(502).json({ error: { message: err.message } });
  }
});

// Poll the device-code flow. On success, store the connection (encrypted).
const pollSchema = z.object({ authId: z.string().min(8) });
connectionsRouter.post('/kiro/poll', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const parsed = pollSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: { message: 'Invalid request' } }); return; }
  const p = pending.get(parsed.data.authId);
  if (!p || p.orgId !== org) { res.status(404).json({ error: { message: 'Unknown or expired auth session' } }); return; }
  if (p.expiresAt < Date.now()) { pending.delete(parsed.data.authId); res.status(410).json({ status: 'expired' }); return; }

  const result = await pollDeviceToken(p.clientId, p.clientSecret, p.deviceCode, p.region);
  if (!result.success) {
    if (result.pending) { res.json({ status: 'pending' }); return; }
    res.status(400).json({ status: 'error', error: result.error });
    return;
  }
  const t = result.tokens;
  const id = await saveProviderConnection(org, {
    provider: 'kiro',
    authType: p.authType,
    label: 'Kiro (AWS Builder ID)',
    secret: { accessToken: t.accessToken, refreshToken: t.refreshToken, clientId: p.clientId, clientSecret: p.clientSecret, region: p.region, startUrl: p.startUrl },
    expiresAt: t.expiresIn ? new Date(Date.now() + t.expiresIn * 1000) : null,
  });
  pending.delete(parsed.data.authId);
  await audit(req, 'connection.create', 'provider_connection', String(id), { provider: 'kiro' });
  res.json({ status: 'connected', id });
});

// Enable/disable a connection.
const patchSchema = z.object({ enabled: z.boolean() });
connectionsRouter.patch('/:id', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const id = parseInt(req.params.id as string, 10);
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (isNaN(id) || !parsed.success) { res.status(400).json({ error: { message: 'Invalid request' } }); return; }
  const ok = await setProviderConnectionEnabled(org, id, parsed.data.enabled);
  if (!ok) { res.status(404).json({ error: { message: 'Connection not found' } }); return; }
  await audit(req, 'connection.update', 'provider_connection', String(id), { enabled: parsed.data.enabled });
  res.json({ success: true });
});

// Delete a connection.
connectionsRouter.delete('/:id', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: { message: 'Invalid id' } }); return; }
  const ok = await deleteProviderConnection(org, id);
  if (!ok) { res.status(404).json({ error: { message: 'Connection not found' } }); return; }
  await audit(req, 'connection.delete', 'provider_connection', String(id));
  res.json({ success: true });
});
