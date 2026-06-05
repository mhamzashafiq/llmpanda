import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { routeRequest, recordRateLimitHit, recordSuccess, hasEnabledVisionModel, type RouteResult } from '../services/router.js';
import { recordRequest, recordTokens, setCooldown, getCooldownDurationForLimit } from '../services/ratelimit.js';
import { checkQuota, bumpQuota } from '../services/quota.js';
import { resolveClientKeyFull } from '../db/index.js';
import { sql } from '../db/client.js';
import { contentToString, messageHasImage } from '../lib/content.js';
import {
  anthropicMessagesSchema,
  anthropicToInternal,
  internalToAnthropic,
  AnthropicStreamEncoder,
} from '../lib/anthropic-translate.js';
import {
  isRetryableError,
  isKeylessPaywall,
  extractApiToken,
  getStickyModel,
  setStickyModel,
  logRequest,
} from './proxy.js';

export const messagesRouter = Router();

// ─────────────────────────────────────────────────────────────────────────
// Anthropic Messages API shim (POST /v1/messages).
//
// Claude Code (and any Anthropic-SDK client) speaks the Messages API. This
// endpoint accepts an Anthropic-shaped request, translates it to the internal
// chat-message format, runs it through the SAME router/retry machinery as the
// proxy, and translates the result back into the Messages object / SSE event
// stream Claude Code expects.
//
// Self-contained on purpose (mirrors responses.ts): it duplicates the proxy's
// retry loop rather than refactoring the battle-tested /chat/completions
// handler, so the production path is untouched. Pure translation lives in
// lib/anthropic-translate.ts; side-effect-free helpers (auth, routing, sticky
// sessions, logging) are imported, not re-implemented.
// ─────────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 20;

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString('hex')}`;
}

// Resolve the preferred model db id from the requested model string. Unlike the
// OpenAI proxy (which 400s unknown models), Claude Code sends built-in `claude-*`
// names it can't pick from our catalog — so auto / missing / claude* / unknown /
// out-of-allow-list all fall back to auto routing; only an exact enabled model_id
// that is allowed pins.
async function resolvePreferredModel(
  model: string | undefined,
  messages: Parameters<typeof getStickyModel>[0],
  allowedSet: Set<number> | undefined,
): Promise<number | undefined> {
  const sticky = getStickyModel(messages);
  if (!model || model === 'auto' || /^claude/i.test(model)) return sticky;
  const [enabled] = await sql<{ id: number }[]>`SELECT id FROM models WHERE model_id = ${model} AND enabled = 1`;
  if (enabled && (!allowedSet || allowedSet.size === 0 || allowedSet.has(enabled.id))) return enabled.id;
  return sticky;
}

messagesRouter.post('/messages', async (req: Request, res: Response) => {
  const start = Date.now();

  // Same unified-key auth as the proxy (Bearer or x-api-key). The key resolves
  // to exactly one org — the tenant boundary — plus its model allow-list.
  const token = extractApiToken(req);
  const keyCtx = token ? await resolveClientKeyFull(token) : null;
  if (keyCtx === null) {
    res.status(401).json({ type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } });
    return;
  }
  const { orgId, allowedModelIds } = keyCtx;
  const allowedSet = allowedModelIds && allowedModelIds.length > 0 ? new Set(allowedModelIds) : undefined;

  const quota = await checkQuota(orgId);
  if (!quota.allowed) {
    res.status(429).json({ type: 'error', error: { type: 'rate_limit_error', message: `Monthly request quota reached (${quota.used}/${quota.limit} on the ${quota.plan} plan).` } });
    return;
  }

  const parsed = anthropicMessagesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Invalid request: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      },
    });
    return;
  }

  const reqData = parsed.data;
  const { messages, options } = anthropicToInternal(reqData);
  const stream = reqData.stream ?? false;

  // Image requests must route to a vision-capable model.
  const hasImage = messageHasImage(messages);
  if (hasImage && !(await hasEnabledVisionModel(orgId))) {
    res.status(422).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'This request includes an image, but no vision-capable model is enabled. Enable a vision model (e.g. Gemini 2.5 Flash, Llama 4 Scout) in the Fallback Chain.',
      },
    });
    return;
  }

  const estimatedInputTokens = messages.reduce(
    (sum, m) => sum + Math.ceil(contentToString(m.content).length / 4),
    0,
  );
  const IMAGE_TOKEN_ESTIMATE = 1000;
  const imageCount = messages.reduce((n, m) =>
    n + (Array.isArray(m.content) ? m.content.filter(b => (b as { type?: string })?.type === 'image_url' || (b as { type?: string })?.type === 'image').length : 0), 0);
  const estimatedTotal = estimatedInputTokens + imageCount * IMAGE_TOKEN_ESTIMATE + reqData.max_tokens;

  const preferredModel = await resolvePreferredModel(reqData.model, messages, allowedSet);
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const promptPreview = lastUser ? contentToString(lastUser.content) : null;

  const responseId = newId('msg');
  const skipKeys = new Set<string>();
  let lastError: any = null;
  let encoder: AnthropicStreamEncoder | null = null; // set once the stream starts

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let route: RouteResult;
    try {
      route = await routeRequest(orgId, estimatedTotal, skipKeys.size > 0 ? skipKeys : undefined, preferredModel, hasImage, allowedSet);
    } catch (err: any) {
      if (encoder) {
        // Already streaming — can't fall back; emit an error event + close.
        for (const f of encoder.error(lastError ? `All models rate-limited. Last error: ${lastError.message}` : err.message)) res.write(f);
        res.end();
        return;
      }
      const status = lastError ? 429 : (err.status ?? 503);
      const type = lastError ? 'rate_limit_error' : 'api_error';
      const message = lastError ? `All models rate-limited. Last error: ${lastError.message}` : err.message;
      res.status(status).json({ type: 'error', error: { type, message } });
      return;
    }

    await recordRequest(orgId, route.platform, route.modelId, route.keyId);
    bumpQuota(orgId);

    try {
      if (stream) {
        if (!encoder) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
          encoder = new AnthropicStreamEncoder({ id: responseId, model: route.modelId, inputTokens: estimatedInputTokens });
          for (const f of encoder.start()) res.write(f);
        }

        let respText = '';
        const gen = route.provider.streamChatCompletion(route.apiKey, messages, route.modelId, options);
        for await (const chunk of gen) {
          for (const f of encoder.chunk(chunk)) res.write(f);
          const t = chunk.choices?.[0]?.delta?.content;
          if (typeof t === 'string' && respText.length < 4001) respText += t;
        }
        for (const f of encoder.finish()) res.write(f);
        res.end();

        await recordTokens(orgId, route.platform, route.modelId, route.keyId, estimatedInputTokens + encoder.outputTokens);
        recordSuccess(route.modelDbId);
        setStickyModel(messages, route.modelDbId);
        await logRequest(orgId, route.platform, route.modelId, route.keyId, 'success', estimatedInputTokens, encoder.outputTokens, Date.now() - start, null, null, promptPreview, respText || null);
        return;
      } else {
        const result = await route.provider.chatCompletion(route.apiKey, messages, route.modelId, options);
        const msg = result.choices[0]?.message;
        const text = contentToString(msg?.content ?? '');
        const promptTokens = result.usage?.prompt_tokens ?? estimatedInputTokens;
        const completionTokens = result.usage?.completion_tokens ?? Math.ceil(text.length / 4);

        await recordTokens(orgId, route.platform, route.modelId, route.keyId, result.usage?.total_tokens ?? 0);
        recordSuccess(route.modelDbId);
        setStickyModel(messages, route.modelDbId);

        res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
        if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
        res.json(internalToAnthropic(result, route.modelId, responseId));

        await logRequest(orgId, route.platform, route.modelId, route.keyId, 'success', promptTokens, completionTokens, Date.now() - start, null, null, promptPreview, text || null);
        return;
      }
    } catch (err: any) {
      const latency = Date.now() - start;
      await logRequest(orgId, route.platform, route.modelId, route.keyId, 'error', estimatedInputTokens, 0, latency, err.message, null, promptPreview, null);

      // Mid-stream failure: bytes already sent — emit an error event + close.
      if (stream && encoder) {
        for (const f of encoder.error(`Provider error (${route.displayName}): stream interrupted`)) res.write(f);
        res.end();
        return;
      }

      // Keyless model whose free access was pulled (paywall): disable it
      // catalog-wide and fall through to the next model (mirrors proxy.ts).
      if (route.keyId === 0 && isKeylessPaywall(err)) {
        await sql`UPDATE models SET enabled = 0 WHERE id = ${route.modelDbId}`;
        skipKeys.add(`${route.platform}:${route.modelId}:${route.keyId}`);
        lastError = err;
        continue;
      }

      if (isRetryableError(err)) {
        skipKeys.add(`${route.platform}:${route.modelId}:${route.keyId}`);
        await setCooldown(orgId, route.platform, route.modelId, route.keyId, await getCooldownDurationForLimit(orgId, route.platform, route.modelId, route.keyId, { rpd: route.rpdLimit, tpd: route.tpdLimit }));
        recordRateLimitHit(route.modelDbId);
        lastError = err;
        continue;
      }

      res.status(502).json({ type: 'error', error: { type: 'api_error', message: `Provider error (${route.displayName}): ${err.message}` } });
      return;
    }
  }

  res.status(429).json({ type: 'error', error: { type: 'rate_limit_error', message: `All models rate-limited after ${MAX_RETRIES} attempts. Last: ${lastError?.message}` } });
});

// Token counting probe (Anthropic clients may call this before a request).
// Cheap heuristic (~4 chars/token); good enough for budgeting, never billed.
messagesRouter.post('/messages/count_tokens', async (req: Request, res: Response) => {
  const token = extractApiToken(req);
  const keyCtx = token ? await resolveClientKeyFull(token) : null;
  if (keyCtx === null) {
    res.status(401).json({ type: 'error', error: { type: 'authentication_error', message: 'Invalid API key' } });
    return;
  }
  const parsed = anthropicMessagesSchema.partial({ max_tokens: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ type: 'error', error: { type: 'invalid_request_error', message: 'Invalid request' } });
    return;
  }
  const { messages } = anthropicToInternal(parsed.data as Parameters<typeof anthropicToInternal>[0]);
  const input_tokens = messages.reduce((sum, m) => sum + Math.ceil(contentToString(m.content).length / 4), 0);
  res.json({ input_tokens });
});
