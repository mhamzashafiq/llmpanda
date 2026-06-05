import { describe, it, expect, beforeAll, vi } from 'vitest';

// Mock only routeRequest so we don't need real provider keys; keep the rest of
// the router module (recordSuccess / recordRateLimitHit / hasEnabledVisionModel)
// intact. Mirrors responses.test.ts. Requires a live test Postgres (the route
// touches the DB for auth/quota/seed) — same harness constraint as that file.
const { mockRouteRequest } = vi.hoisted(() => ({ mockRouteRequest: vi.fn() }));
vi.mock('../../services/router.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/router.js')>();
  return { ...actual, routeRequest: mockRouteRequest };
});

import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getUnifiedApiKey } from '../../db/index.js';

function fakeRoute(provider: any) {
  return { provider, modelId: 'fake-model', modelDbId: 9999, apiKey: 'k', keyId: 1, platform: 'fake', displayName: 'Fake Model' };
}

async function post(app: Express, path: string, body: any, key?: string, header: 'authorization' | 'x-api-key' = 'authorization') {
  const server = app.listen(0);
  const addr = server.address() as any;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers[header] = header === 'authorization' ? `Bearer ${key}` : key;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  server.close();
  return { status: res.status, text, contentType: res.headers.get('content-type') ?? '' };
}

describe('POST /v1/messages (Anthropic Messages API)', () => {
  let app: Express;
  let key: string;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:' as any);
    app = createApp();
    key = getUnifiedApiKey() as any;
  });

  it('rejects requests without a valid key (401)', async () => {
    expect((await post(app, '/v1/messages', { max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })).status).toBe(401);
    expect((await post(app, '/v1/messages', { max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, 'wrong')).status).toBe(401);
  });

  it('rejects a body missing max_tokens with 400', async () => {
    expect((await post(app, '/v1/messages', { messages: [{ role: 'user', content: 'hi' }] }, key)).status).toBe(400);
  });

  it('accepts the key via the x-api-key header (Anthropic wire format)', async () => {
    mockRouteRequest.mockReturnValue(fakeRoute({
      async chatCompletion() {
        return { id: 'c', object: 'chat.completion', created: 0, model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      },
      async *streamChatCompletion() { /* unused */ },
    }));
    const { status } = await post(app, '/v1/messages', { max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }, key, 'x-api-key');
    expect(status).not.toBe(401);
  });

  it('non-stream: returns an Anthropic message object with content + usage', async () => {
    mockRouteRequest.mockReturnValue(fakeRoute({
      async chatCompletion() {
        return { id: 'c', object: 'chat.completion', created: 0, model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from fake' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } };
      },
      async *streamChatCompletion() { /* unused */ },
    }));
    const { status, text } = await post(app, '/v1/messages', { max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }, key);
    expect(status).toBe(200);
    const body = JSON.parse(text);
    expect(body.type).toBe('message');
    expect(body.role).toBe('assistant');
    expect(body.content).toEqual([{ type: 'text', text: 'Hello from fake' }]);
    expect(body.stop_reason).toBe('end_turn');
    expect(body.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
  });

  it('does NOT 400 on an unknown/claude-* model — routes via auto', async () => {
    mockRouteRequest.mockReturnValue(fakeRoute({
      async chatCompletion() {
        return { id: 'c', object: 'chat.completion', created: 0, model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
      },
      async *streamChatCompletion() { /* unused */ },
    }));
    const { status } = await post(app, '/v1/messages', { model: 'claude-3-5-sonnet-20241022', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] }, key);
    expect(status).toBe(200);
  });

  it('stream: emits the Anthropic SSE event sequence', async () => {
    mockRouteRequest.mockReturnValue(fakeRoute({
      async chatCompletion() { throw new Error('should not be called'); },
      async *streamChatCompletion() {
        yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' }, finish_reason: null }] };
        yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] };
        yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      },
    }));
    const { status, text, contentType } = await post(app, '/v1/messages', { max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'hi' }] }, key);
    expect(status).toBe(200);
    expect(contentType).toContain('text/event-stream');
    for (const ev of ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']) {
      expect(text).toContain(`event: ${ev}`);
    }
    expect(text).toContain('"type":"text_delta","text":"Hel"');
    expect(text).toContain('"type":"text_delta","text":"lo"');
    expect(text).toContain('"stop_reason":"end_turn"');
  });

  it('stream: tool-call deltas produce tool_use + input_json_delta events', async () => {
    mockRouteRequest.mockReturnValue(fakeRoute({
      async chatCompletion() { throw new Error('nope'); },
      async *streamChatCompletion() {
        yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } }] }, finish_reason: null }] };
        yield { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, type: 'function', function: { arguments: 'ty":"SF"}' } }] }, finish_reason: 'tool_calls' }] };
      },
    }));
    const { text } = await post(app, '/v1/messages', { max_tokens: 64, stream: true, messages: [{ role: 'user', content: 'weather?' }] }, key);
    expect(text).toContain('"type":"tool_use"');
    expect(text).toContain('"name":"get_weather"');
    expect(text).toContain('event: content_block_delta');
    expect(text).toContain('"stop_reason":"tool_use"');
  });
});
