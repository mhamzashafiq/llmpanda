import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Platform } from '@freellmapi/shared/types.js';
import { resolveOrgByClientKey } from '../db/index.js';
import { sql } from '../db/client.js';
import { getProvider, isKeylessPlatform } from '../providers/index.js';
import { decryptForOrg } from '../lib/crypto.js';
import { checkQuota, bumpQuota } from '../services/quota.js';
import { extractApiToken, isRetryableError, logRequest } from './proxy.js';

// OpenAI-compatible embeddings: POST /v1/embeddings.
// No keyless upstream offers embeddings on the anonymous tier today, so these
// route through the org's own provider keys (Mistral / NVIDIA / Together free
// tiers — all no-card). The registry maps a requested model id to its platform;
// the route picks the first model the org actually holds a key for.
export const embeddingsRouter = Router();

interface EmbeddingModel {
  id: string;
  platform: Platform;
  displayName: string;
}

const EMBEDDING_MODELS: EmbeddingModel[] = [
  { id: 'mistral-embed', platform: 'mistral', displayName: 'Mistral Embed' },
  { id: 'nvidia/nv-embedqa-e5-v5', platform: 'nvidia', displayName: 'NV-EmbedQA E5 (NVIDIA)' },
  { id: 'BAAI/bge-base-en-v1.5', platform: 'together', displayName: 'BGE Base EN (Together)' },
];

function getEmbeddingModel(id?: string): EmbeddingModel | undefined {
  if (!id || id === 'auto') return EMBEDDING_MODELS[0];
  // Exact id match, else first model on the same platform (clients often send
  // an OpenAI id like "text-embedding-3-small" — fall back to the default).
  return EMBEDDING_MODELS.find(m => m.id === id);
}

const requestSchema = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  model: z.string().optional(),
  encoding_format: z.enum(['float', 'base64']).optional(),
});

embeddingsRouter.get('/models', (_req: Request, res: Response) => {
  res.json({
    object: 'list',
    data: EMBEDDING_MODELS.map(m => ({ id: m.id, object: 'model', created: 0, owned_by: m.platform, name: m.displayName })),
  });
});

// Resolve one usable key for a platform from the org, or '' for keyless platforms.
async function resolveKeyFor(orgId: number, platform: string): Promise<string | null> {
  const keys = await sql<{ encrypted_key: string; iv: string; auth_tag: string }[]>`
    SELECT encrypted_key, iv, auth_tag FROM api_keys
    WHERE platform = ${platform} AND enabled = 1 AND status IN ('healthy', 'unknown') AND org_id = ${orgId}
    LIMIT 1`;
  if (keys.length > 0) {
    try { return await decryptForOrg(orgId, keys[0].encrypted_key, keys[0].iv, keys[0].auth_tag); }
    catch { return null; }
  }
  return isKeylessPlatform(platform) ? '' : null;
}

embeddingsRouter.post('/', async (req: Request, res: Response) => {
  const start = Date.now();
  const token = extractApiToken(req);
  const orgId = token ? await resolveOrgByClientKey(token) : null;
  if (orgId === null) {
    res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
    return;
  }

  const quota = await checkQuota(orgId);
  if (!quota.allowed) {
    res.status(429).json({ error: { message: `Monthly request quota reached (${quota.used}/${quota.limit}).`, type: 'quota_exceeded', code: 'monthly_quota_exceeded' } });
    return;
  }

  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`, type: 'invalid_request_error' } });
    return;
  }

  const { input, model: requested } = parsed.data;
  // Build the candidate order: the requested model first (if known), then any
  // other registry model the org has a key for.
  const preferred = getEmbeddingModel(requested);
  const candidates = preferred ? [preferred, ...EMBEDDING_MODELS.filter(m => m.id !== preferred.id)] : EMBEDDING_MODELS;

  let lastErr: any = null;
  for (const m of candidates) {
    const provider = getProvider(m.platform);
    if (!provider?.embeddings) continue;
    const apiKey = await resolveKeyFor(orgId, m.platform);
    if (apiKey === null) continue; // no usable key for this platform

    try {
      const result = await provider.embeddings(apiKey, input, m.id);
      bumpQuota(orgId);
      const tokens = result.usage?.total_tokens ?? 0;
      res.setHeader('X-Routed-Via', `${m.platform}/${m.id}`);
      res.json(result);
      await logRequest(orgId, m.platform, m.id, 0, 'success', tokens, 0, Date.now() - start, null);
      return;
    } catch (err: any) {
      lastErr = err;
      if (!isRetryableError(err)) break; // hard error on this model — stop, surface it
    }
  }

  if (lastErr) {
    res.status(502).json({ error: { message: `Embedding provider error: ${lastErr.message}`, type: 'provider_error' } });
  } else {
    res.status(422).json({
      error: {
        message: `No embedding-capable key configured. Add a free key for one of: ${EMBEDDING_MODELS.map(m => m.platform).join(', ')}.`,
        type: 'invalid_request_error', code: 'no_embedding_model',
      },
    });
  }
  await logRequest(orgId, 'embeddings', requested ?? 'auto', 0, 'error', 0, 0, Date.now() - start, lastErr?.message ?? 'no embedding key');
});
