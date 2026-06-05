import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { encryptForOrg, decryptForOrg, maskKey } from '../lib/crypto.js';
import { requireOrg } from '../lib/tenant.js';
import { audit } from '../services/audit.js';

export const keysRouter = Router();

// Active providers — must match providers/index.ts registrations + shared/types.ts Platform.
const PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'huggingface', 'together', 'opencode', 'custom',
  'opencode-free', 'chutes', 'dashscope', 'modelscope', 'vertex', 'kiro', 'copilot',
] as const;

const addKeySchema = z.object({
  platform: z.enum(PLATFORMS),
  key: z.string().min(1),
  label: z.string().optional(),
});

const updateKeySchema = z.object({
  enabled: z.boolean().optional(),
  label: z.string().optional(),
}).refine(data => data.enabled !== undefined || data.label !== undefined, {
  message: 'At least one of enabled or label must be provided',
});

// List the caller org's keys (masked)
keysRouter.get('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const rows = await sql<any[]>`SELECT * FROM api_keys WHERE org_id = ${org} ORDER BY created_at DESC`;

  const keys = await Promise.all(rows.map(async row => {
    let maskedKey = '****';
    try {
      maskedKey = maskKey(await decryptForOrg(org, row.encrypted_key, row.iv, row.auth_tag));
    } catch {
      maskedKey = '[decrypt failed]';
    }
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      maskedKey,
      baseUrl: row.base_url ?? null,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
    };
  }));

  res.json(keys);
});

// Add a key
keysRouter.post('/', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { platform, key, label } = parsed.data;
  const { encrypted, iv, authTag } = await encryptForOrg(org, key);

  const [row] = await sql<{ id: number }[]>`
    INSERT INTO api_keys (org_id, platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (${org}, ${platform}, ${label ?? ''}, ${encrypted}, ${iv}, ${authTag}, 'unknown', 1)
    RETURNING id`;

  await audit(req, 'provider_key.add', 'api_key', String(row.id), { platform });

  res.status(201).json({
    id: row.id,
    platform,
    label: label ?? '',
    maskedKey: maskKey(key),
    status: 'unknown',
    enabled: true,
  });
});

// ── Custom OpenAI-compatible provider (#117) ──────────────────────────────
const customProviderSchema = z.object({
  baseUrl: z.string().url('baseUrl must be a valid URL'),
  model: z.string().min(1, 'model is required'),
  displayName: z.string().optional(),
  apiKey: z.string().optional(),
  label: z.string().optional(),
});

keysRouter.post('/custom', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const parsed = customProviderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const baseUrl = parsed.data.baseUrl.trim().replace(/\/+$/, '');
  const modelId = parsed.data.model.trim();
  const displayName = (parsed.data.displayName ?? modelId).trim();
  const rawKey = parsed.data.apiKey?.trim() || 'no-key';
  const label = parsed.data.label ?? 'Custom';

  const result = await sql.begin(async tx => {
    // Scope the custom-endpoint key to this org (each org runs its own custom provider).
    const [existing] = await tx<{ id: number }[]>`SELECT id FROM api_keys WHERE platform = 'custom' AND org_id = ${org} LIMIT 1`;
    const { encrypted, iv, authTag } = await encryptForOrg(org, rawKey);
    let keyId: number;
    if (existing) {
      await tx`UPDATE api_keys SET base_url = ${baseUrl}, encrypted_key = ${encrypted}, iv = ${iv}, auth_tag = ${authTag}, status = 'unknown', enabled = 1 WHERE id = ${existing.id} AND org_id = ${org}`;
      keyId = existing.id;
    } else {
      const [r] = await tx<{ id: number }[]>`
        INSERT INTO api_keys (org_id, platform, label, encrypted_key, iv, auth_tag, status, enabled, base_url)
        VALUES (${org}, 'custom', ${label}, ${encrypted}, ${iv}, ${authTag}, 'unknown', 1, ${baseUrl})
        RETURNING id`;
      keyId = r.id;
    }

    // The model row is part of the shared catalog (global); only the key + the
    // org's fallback chain are tenant-scoped.
    await tx`
      INSERT INTO models
        (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
         rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window, enabled)
      VALUES ('custom', ${modelId}, ${displayName}, 50, 50, 'Custom', NULL, NULL, NULL, NULL, '', NULL, 1)
      ON CONFLICT (platform, model_id) DO NOTHING`;

    const [modelRow] = await tx<{ id: number }[]>`SELECT id FROM models WHERE platform = 'custom' AND model_id = ${modelId}`;

    const [inChain] = await tx`SELECT 1 FROM fallback_config WHERE model_db_id = ${modelRow.id} AND org_id = ${org}`;
    if (!inChain) {
      const [max] = await tx<{ m: number }[]>`SELECT COALESCE(MAX(priority), 0)::int AS m FROM fallback_config WHERE org_id = ${org}`;
      await tx`INSERT INTO fallback_config (org_id, model_db_id, priority, enabled) VALUES (${org}, ${modelRow.id}, ${max.m + 1}, 1)`;
    }

    return { keyId, modelDbId: modelRow.id };
  });

  res.status(201).json({
    success: true,
    keyId: result.keyId,
    modelDbId: result.modelDbId,
    platform: 'custom',
    baseUrl,
    model: modelId,
    displayName,
    maskedKey: maskKey(rawKey),
  });
});

// Delete a key
keysRouter.delete('/:id', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }
  const result = await sql`DELETE FROM api_keys WHERE id = ${id} AND org_id = ${org}`;
  if (result.count === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }
  await audit(req, 'provider_key.delete', 'api_key', String(id));
  res.json({ success: true });
});

// Toggle all keys for a platform
keysRouter.patch('/platform/:platform', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const platform = req.params.platform as string;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    res.status(400).json({ error: { message: `Invalid platform '${platform}'` } });
    return;
  }
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }
  const result = await sql`UPDATE api_keys SET enabled = ${enabled ? 1 : 0} WHERE platform = ${platform} AND org_id = ${org}`;
  res.json({ success: true, enabled, updatedKeys: result.count });
});

// Update key (toggle enable/disable or edit label)
keysRouter.patch('/:id', async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (org === null) return;
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }
  const parsed = updateKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { enabled, label } = parsed.data;
  let result;
  if (enabled !== undefined && label !== undefined) {
    result = await sql`UPDATE api_keys SET enabled = ${enabled ? 1 : 0}, label = ${label} WHERE id = ${id} AND org_id = ${org}`;
  } else if (enabled !== undefined) {
    result = await sql`UPDATE api_keys SET enabled = ${enabled ? 1 : 0} WHERE id = ${id} AND org_id = ${org}`;
  } else {
    result = await sql`UPDATE api_keys SET label = ${label!} WHERE id = ${id} AND org_id = ${org}`;
  }

  if (result.count === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  const response: Record<string, unknown> = { success: true };
  if (enabled !== undefined) response.enabled = enabled;
  if (label !== undefined) response.label = label;
  res.json(response);
});
