import { describe, it, expect, vi, afterEach } from 'vitest';
import { getProvider, hasProvider } from '../../providers/index.js';

describe('Together AI provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is registered under the "together" platform', () => {
    expect(hasProvider('together')).toBe(true);
    const provider = getProvider('together');
    expect(provider?.platform).toBe('together');
    expect(provider?.name).toBe('Together AI');
  });

  it('sends chat completions to the Together base URL with bearer auth', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      capturedUrl = url as string;
      capturedHeaders = (init as any).headers;
      return {
        ok: true,
        json: () => Promise.resolve({
          id: 'x', object: 'chat.completion', created: 1, model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as any;
    });

    const provider = getProvider('together')!;
    await provider.chatCompletion('tok', [{ role: 'user', content: 'test' }], 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free');

    expect(capturedUrl).toBe('https://api.together.xyz/v1/chat/completions');
    expect(capturedHeaders['Authorization']).toBe('Bearer tok');
  });

  it('streams chat completion chunks parsed from SSE', async () => {
    const sse = [
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
      'data: {"id":"x","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const encoder = new TextEncoder();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      body: {
        getReader() {
          let sent = false;
          return {
            read() {
              if (sent) return Promise.resolve({ done: true, value: undefined });
              sent = true;
              return Promise.resolve({ done: false, value: encoder.encode(sse) });
            },
          };
        },
      },
    } as any);

    const provider = getProvider('together')!;
    let text = '';
    for await (const chunk of provider.streamChatCompletion('tok', [{ role: 'user', content: 'hi' }], 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free')) {
      text += chunk.choices?.[0]?.delta?.content ?? '';
    }
    expect(text).toBe('Hello');
  });
});
