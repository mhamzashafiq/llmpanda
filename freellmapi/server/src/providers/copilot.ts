import crypto from 'crypto';
import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, Platform } from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';

// GitHub Copilot provider. The "apiKey" is a short-lived Copilot token resolved
// by the router from the org's OAuth connection (services/connection-token.ts).
// The chat endpoint is OpenAI-compatible — we just inject the Copilot headers.
//
// ⚠️ Proxies the user's Copilot subscription — opt-in, off the default route.

const COPILOT_URL = 'https://api.githubcopilot.com/chat/completions';

function copilotHeaders(token: string, stream: boolean): Record<string, string> {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'copilot-integration-id': 'vscode-chat',
    'editor-version': 'vscode/1.85.0',
    'editor-plugin-version': 'copilot-chat/0.26.7',
    'user-agent': 'GitHubCopilotChat/0.26.7',
    'openai-intent': 'conversation-panel',
    'x-github-api-version': '2025-04-01',
    'x-request-id': crypto.randomUUID(),
    'x-vscode-user-agent-library-version': 'electron-fetch',
    'X-Initiator': 'user',
    'Accept': stream ? 'text/event-stream' : 'application/json',
  };
}

export class CopilotProvider extends BaseProvider {
  readonly platform: Platform = 'copilot';
  readonly name = 'GitHub Copilot';

  private body(messages: ChatMessage[], modelId: string, options: CompletionOptions | undefined, stream: boolean): string {
    return JSON.stringify({
      model: modelId,
      messages,
      temperature: options?.temperature,
      max_tokens: options?.max_tokens,
      top_p: options?.top_p,
      tools: options?.tools,
      tool_choice: options?.tool_choice,
      ...(options?.stop?.length ? { stop: options.stop } : {}),
      ...(stream ? { stream: true } : {}),
    });
  }

  async chatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): Promise<ChatCompletionResponse> {
    const res = await this.fetchWithTimeout(COPILOT_URL, { method: 'POST', headers: copilotHeaders(apiKey, false), body: this.body(messages, modelId, options, false) }, 120000);
    if (!res.ok) throw new Error(`Copilot API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const data = await res.json() as ChatCompletionResponse;
    data._routed_via = { platform: this.platform, model: modelId };
    return data;
  }

  async *streamChatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): AsyncGenerator<ChatCompletionChunk> {
    const res = await this.fetchWithTimeout(COPILOT_URL, { method: 'POST', headers: copilotHeaders(apiKey, true), body: this.body(messages, modelId, options, true) }, 120000);
    if (!res.ok) throw new Error(`Copilot API error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
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
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        const payload = t.slice(6);
        if (payload === '[DONE]') return;
        try { yield JSON.parse(payload) as ChatCompletionChunk; } catch { /* skip */ }
      }
    }
  }

  async validateKey(apiKey: string): Promise<boolean> {
    return typeof apiKey === 'string' && apiKey.length > 0;
  }
}
