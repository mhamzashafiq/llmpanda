import { describe, it, expect, vi, afterEach } from 'vitest';
import { getProvider, hasProvider } from '../../providers/index.js';

describe('OpenCode Zen provider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is registered under the "opencode" platform', () => {
    expect(hasProvider('opencode')).toBe(true);
    const provider = getProvider('opencode');
    expect(provider?.platform).toBe('opencode');
    expect(provider?.name).toBe('OpenCode Zen');
  });

  it('sends chat completions to the OpenCode Zen base URL with bearer auth', async () => {
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

    const provider = getProvider('opencode')!;
    await provider.chatCompletion('tok', [{ role: 'user', content: 'test' }], 'big-pickle');

    expect(capturedUrl).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(capturedHeaders['Authorization']).toBe('Bearer tok');
  });
});
