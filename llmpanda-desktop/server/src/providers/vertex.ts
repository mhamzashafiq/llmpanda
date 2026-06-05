import crypto from 'crypto';
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, Platform } from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';

// Google Vertex AI provider. The "key" is a service-account JSON (stored
// encrypted in api_keys). We mint a short-lived OAuth access token from it via a
// signed JWT (pure node crypto — no extra dependency), cache it per service
// account, and call Vertex's OpenAI-compatible endpoint. Distinct from google.ts
// (which targets AI Studio with a simple API key).

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

const tokenCache = new Map<string, { token: string; exp: number }>();

function parseServiceAccount(raw: string): ServiceAccount {
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('Vertex key must be a service-account JSON with client_email, private_key and project_id');
  }
  return sa;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.exp > now + 60) return cached.token;

  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUri,
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const signingInput = `${header}.${claim}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key).toString('base64url');
  const assertion = `${signingInput}.${sig}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Vertex token exchange failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json() as { access_token: string; expires_in?: number };
  tokenCache.set(sa.client_email, { token: data.access_token, exp: now + (data.expires_in ?? 3600) });
  return data.access_token;
}

export class VertexProvider extends BaseProvider {
  readonly platform: Platform = 'vertex';
  readonly name = 'Google Vertex AI';
  // OpenAI-compatible Vertex endpoint (global location works for Gemini).
  private endpoint(sa: ServiceAccount): string {
    return `https://aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/global/endpoints/openapi/chat/completions`;
  }

  private body(messages: ChatMessage[], modelId: string, options?: CompletionOptions, stream = false) {
    return JSON.stringify({
      model: modelId,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.max_tokens,
      top_p: options?.top_p,
      tools: options?.tools,
      tool_choice: options?.tool_choice,
      parallel_tool_calls: options?.parallel_tool_calls,
      ...(options?.stop?.length ? { stop: options.stop } : {}),
      ...(stream ? { stream: true } : {}),
    });
  }

  async chatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): Promise<ChatCompletionResponse> {
    const sa = parseServiceAccount(apiKey);
    const token = await getAccessToken(sa);
    const res = await this.fetchWithTimeout(this.endpoint(sa), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: this.body(messages, modelId, options),
    }, 120000);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Vertex API error ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json() as ChatCompletionResponse;
    data._routed_via = { platform: this.platform, model: modelId };
    return data;
  }

  async *streamChatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): AsyncGenerator<ChatCompletionChunk> {
    const sa = parseServiceAccount(apiKey);
    const token = await getAccessToken(sa);
    const res = await this.fetchWithTimeout(this.endpoint(sa), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: this.body(messages, modelId, options, true),
    }, 120000);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Vertex API error ${res.status}: ${err.slice(0, 200)}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const payload = trimmed.slice(6);
        if (payload === '[DONE]') return;
        try { yield JSON.parse(payload) as ChatCompletionChunk; } catch { /* skip */ }
      }
    }
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      await getAccessToken(parseServiceAccount(apiKey));
      return true;
    } catch {
      return false;
    }
  }
}
