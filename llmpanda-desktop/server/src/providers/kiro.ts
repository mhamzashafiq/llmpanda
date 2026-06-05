import type { ChatMessage, ChatCompletionResponse, ChatCompletionChunk, Platform } from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';
import { buildConversationState, decodeEventStream, eventText, type KiroEvent } from '../lib/kiro-translate.js';

// Kiro (AWS CodeWhisperer) provider. The "apiKey" is a Bearer access token,
// resolved by the router from an enabled provider_connections row (see
// services/kiro-connection.ts). Translates to/from CodeWhisperer's
// conversationState + AWS EventStream binary protocol (lib/kiro-translate.ts).
//
// ⚠️ Proxies the user's Kiro/AWS account — opt-in, off the default route.

const KIRO_ENDPOINT = 'https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse';

export class KiroProvider extends BaseProvider {
  readonly platform: Platform = 'kiro';
  readonly name = 'Kiro (AWS CodeWhisperer)';

  private async send(apiKey: string, body: string): Promise<Response> {
    const res = await this.fetchWithTimeout(KIRO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': 'AmazonCodeWhispererStreamingService.GenerateAssistantResponse',
      },
      body,
    }, 120000);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Kiro API error ${res.status}: ${err.slice(0, 200)}`);
    }
    return res;
  }

  async chatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): Promise<ChatCompletionResponse> {
    const body = JSON.stringify(buildConversationState(messages, modelId, options?.tools));
    const res = await this.send(apiKey, body);
    const buf = new Uint8Array(await res.arrayBuffer());
    const { events } = decodeEventStream(buf);
    let text = '';
    for (const ev of events) text += eventText(ev);
    return {
      id: this.makeId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: Math.ceil(text.length / 4), total_tokens: Math.ceil(text.length / 4) },
      _routed_via: { platform: this.platform, model: modelId },
    };
  }

  async *streamChatCompletion(apiKey: string, messages: ChatMessage[], modelId: string, options?: CompletionOptions): AsyncGenerator<ChatCompletionChunk> {
    const body = JSON.stringify(buildConversationState(messages, modelId, options?.tools));
    const res = await this.send(apiKey, body);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');
    const id = this.makeId();
    const created = Math.floor(Date.now() / 1000);
    let buf: Uint8Array = new Uint8Array(0);
    let first = true;
    const emit = (ev: KiroEvent): ChatCompletionChunk | null => {
      const text = eventText(ev);
      if (!text) return null;
      const delta = first ? { role: 'assistant' as const, content: text } : { content: text };
      first = false;
      return { id, object: 'chat.completion.chunk', created, model: modelId, choices: [{ index: 0, delta, finish_reason: null }] };
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf); merged.set(value, buf.length);
      const { events, rest } = decodeEventStream(merged);
      buf = rest;
      for (const ev of events) { const c = emit(ev); if (c) yield c; }
    }
    // terminal chunk
    yield { id, object: 'chat.completion.chunk', created, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
  }

  // The token's validity is only known by calling CodeWhisperer; assume valid.
  async validateKey(apiKey: string): Promise<boolean> {
    return typeof apiKey === 'string' && apiKey.length > 0;
  }
}
