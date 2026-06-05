import type { Platform } from '@freellmapi/shared/types.js';
import type { BaseProvider } from './base.js';
import { GoogleProvider } from './google.js';
import { OpenAICompatProvider } from './openai-compat.js';
import { CohereProvider } from './cohere.js';
import { CloudflareProvider } from './cloudflare.js';
import { VertexProvider } from './vertex.js';
import { KiroProvider } from './kiro.js';
import { CopilotProvider } from './copilot.js';

const providers = new Map<Platform, BaseProvider>();

function register(provider: BaseProvider) {
  providers.set(provider.platform, provider);
}

// Google - unique Gemini API format
register(new GoogleProvider());

// Groq - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'groq',
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
}));

// Cerebras - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'cerebras',
  name: 'Cerebras',
  baseUrl: 'https://api.cerebras.ai/v1',
}));

// SambaNova - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'sambanova',
  name: 'SambaNova',
  baseUrl: 'https://api.sambanova.ai/v1',
}));

// NVIDIA NIM - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'nvidia',
  name: 'NVIDIA NIM',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
}));

// Mistral - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'mistral',
  name: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
}));

// OpenRouter - OpenAI-compatible with extra headers
register(new OpenAICompatProvider({
  platform: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  extraHeaders: {
    'HTTP-Referer': 'http://localhost:3001',
    'X-Title': 'LLM Panda',
  },
}));

// GitHub Models — OpenAI-compatible. Catalog uses `<publisher>/<model>` ids
// (e.g. `openai/gpt-4.1`); the old Azure endpoint rejects that prefix with
// "Unknown model", so route to the current models.github.ai endpoint.
register(new OpenAICompatProvider({
  platform: 'github',
  name: 'GitHub Models',
  baseUrl: 'https://models.github.ai/inference',
}));

// Cohere - OpenAI-compatible via Cohere compatibility endpoint
register(new CohereProvider());

// Cloudflare Workers AI - OpenAI-compatible endpoint (key = "account_id:token")
register(new CloudflareProvider());

// Zhipu (Z.ai / bigmodel.cn) - OpenAI-compatible
register(new OpenAICompatProvider({
  platform: 'zhipu',
  name: 'Zhipu AI',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
}));

// Hugging Face Inference Providers router — re-added in V13. The V4 removal
// reason ("tool-call format issues") was the legacy serverless route that
// emitted tool calls as text; the new router.huggingface.co meta-router
// uses each backend's native protocol then normalizes the response.
// Recurring $0.10/mo router credit on the free tier, no card required.
register(new OpenAICompatProvider({
  platform: 'huggingface',
  name: 'HuggingFace Router',
  baseUrl: 'https://router.huggingface.co/v1',
}));

// Moonshot direct integration was dropped in V4 (paid-only); MiniMax direct
// was dropped in V4 (superseded by the OpenRouter route).

// Ollama Cloud — OpenAI-compatible. Free plan: 1 concurrent model, 5h session
// caps, GPU-time-based quota (not per-token). Many catalog models on the
// /v1/models list are subscription-only — Free returns 403 with an explicit
// "this model requires a subscription" message. Catalog rows are filtered to
// confirmed-Free entries.
//
// Frontier reasoning models (glm-4.7, kimi-k2-thinking, cogito-2.1:671b)
// regularly take 30-90s on Ollama Cloud Free, so the timeout is bumped from
// the default 15s. Ollama returns reasoning in `message.reasoning` (not
// `reasoning_content`) — handled by normalizeChoices.
register(new OpenAICompatProvider({
  platform: 'ollama',
  name: 'Ollama Cloud',
  baseUrl: 'https://ollama.com/v1',
  timeoutMs: 120000,
}));

// Kilo AI Gateway — OpenAI-compatible aggregator. Anonymous access works
// (200 req/hr per IP) for the few :free routes still active; a Kilo API key
// raises the limit. Most named "free" routes in the docs have transitioned to
// paid ("free period ended") — probe before adding catalog rows.
register(new OpenAICompatProvider({
  platform: 'kilo',
  name: 'Kilo Gateway',
  baseUrl: 'https://api.kilo.ai/api/gateway/v1',
}));

// Pollinations — OpenAI-compatible, anonymous tier. The chat completions
// endpoint lives at `/openai/v1/chat/completions` (NOT `/v1/...` — the
// `/openai` prefix is mandatory). Public model list returns one anonymous
// model (`openai-fast` = GPT-OSS 20B on OVH, tools=true).
register(new OpenAICompatProvider({
  platform: 'pollinations',
  name: 'Pollinations',
  baseUrl: 'https://text.pollinations.ai/openai/v1',
}));

// LLM7.io — OpenAI-compatible aggregator. 100 req/hr free; anonymous access
// also works for basic models. Wraps a handful of upstream models behind one
// token (GPT-OSS, Llama 3.1 Turbo via Meta, Codestral via Mistral, Ministral,
// GLM-4.6V-Flash).
register(new OpenAICompatProvider({
  platform: 'llm7',
  name: 'LLM7',
  baseUrl: 'https://api.llm7.io/v1',
}));

// Chutes was evaluated for V11 and dropped: probe with a free-tier key
// returned 402 on every model — "Quota exceeded and account balance is
// $0.0, please pay with fiat or send tao". The "free" tier requires a
// non-zero balance, which conflicts with the project's no-card criterion.

// Together AI — OpenAI-compatible. Free tier exposes the `*-Free` model slugs
// (e.g. Llama 3.3 70B Turbo Free), no card required for the free pool.
register(new OpenAICompatProvider({
  platform: 'together',
  name: 'Together AI',
  baseUrl: 'https://api.together.xyz/v1',
}));

// OpenCode Zen — OpenAI-compatible gateway (https://opencode.ai/zen/v1). Bearer
// auth with an OpenCode key; ships a free model pool (big-pickle, *-free slugs).
register(new OpenAICompatProvider({
  platform: 'opencode',
  name: 'OpenCode Zen',
  baseUrl: 'https://opencode.ai/zen/v1',
}));

// OpenCode Free — OpenAI-compatible free pool (https://opencode.ai/zen/go/v1):
// MiniMax, Kimi, GLM, DeepSeek, Qwen. Bearer auth with a free OpenCode token.
register(new OpenAICompatProvider({
  platform: 'opencode-free',
  name: 'OpenCode Free',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  timeoutMs: 120000,
}));

// Chutes.ai — decentralized OpenAI-compatible inference (https://llm.chutes.ai/v1).
register(new OpenAICompatProvider({
  platform: 'chutes',
  name: 'Chutes',
  baseUrl: 'https://llm.chutes.ai/v1',
  timeoutMs: 120000,
}));

// Alibaba DashScope (Qwen) — OpenAI-compatible mode (international endpoint).
register(new OpenAICompatProvider({
  platform: 'dashscope',
  name: 'DashScope (Qwen)',
  baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  timeoutMs: 120000,
}));

// Alibaba ModelScope — OpenAI-compatible inference API (https://api-inference.modelscope.cn/v1).
register(new OpenAICompatProvider({
  platform: 'modelscope',
  name: 'ModelScope',
  baseUrl: 'https://api-inference.modelscope.cn/v1',
  timeoutMs: 120000,
}));

// Google Vertex AI — service-account JSON key, OAuth token minted per request.
register(new VertexProvider());

// Kiro (AWS CodeWhisperer) — credential is an OAuth connection (provider_connections),
// resolved by the router; opt-in, off the default route.
register(new KiroProvider());

// GitHub Copilot — OAuth connection (GitHub device flow → Copilot token); opt-in.
register(new CopilotProvider());

// Placeholder so getProvider('custom')/hasProvider('custom')/getAllProviders()
// behave — but the real instance is built per-key by resolveProvider(), since
// a custom provider's base URL is user-supplied and lives on the api_keys row.
register(new OpenAICompatProvider({
  platform: 'custom',
  name: 'Custom (OpenAI-compatible)',
  baseUrl: '',
}));

// Locally-hosted inference (llama.cpp / vLLM / Ollama on CPU) can be slow, so
// custom providers get the same extended timeout as Ollama Cloud.
const CUSTOM_PROVIDER_TIMEOUT_MS = 120000;

export function getProvider(platform: Platform): BaseProvider | undefined {
  return providers.get(platform);
}

/**
 * Resolve the provider for a route. Built-in platforms return their registered
 * singleton; the 'custom' platform builds a fresh OpenAICompatProvider bound to
 * the caller-supplied base URL (stored per api_keys row). Returns undefined for
 * a custom provider with no base URL configured.
 */
export function resolveProvider(platform: Platform, baseUrl?: string | null): BaseProvider | undefined {
  if (platform === 'custom') {
    const trimmed = baseUrl?.trim();
    if (!trimmed) return undefined;
    return new OpenAICompatProvider({
      platform: 'custom',
      name: 'Custom (OpenAI-compatible)',
      baseUrl: trimmed,
      timeoutMs: CUSTOM_PROVIDER_TIMEOUT_MS,
    });
  }
  return providers.get(platform);
}

export function getAllProviders(): BaseProvider[] {
  return Array.from(providers.values());
}

export function hasProvider(platform: Platform): boolean {
  return providers.has(platform);
}

// Providers with an anonymous (no-key) free tier. These route with zero setup:
// the proxy serves their free models even when the org has added no key. Limits
// are upstream IP-based and shared across all tenants, so they're best for
// trying the service — users should add their own free keys for dedicated quota.
// Platforms that serve their free models with NO API key at all (anonymous
// upstream tier). These are the ONLY zero-setup fallback: an org that has added
// no key of its own falls back to these. We never route one tenant through
// another tenant's — or a shared operator — key; every keyed provider is
// strictly bring-your-own-key.
export const KEYLESS_PLATFORMS = new Set<string>(['kilo', 'pollinations', 'llm7']);
export function isKeylessPlatform(platform: string): boolean {
  return KEYLESS_PLATFORMS.has(platform);
}
