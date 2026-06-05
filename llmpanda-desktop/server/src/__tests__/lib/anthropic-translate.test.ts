import { describe, it, expect } from 'vitest';
import {
  anthropicMessagesSchema,
  anthropicToChatMessages,
  anthropicToChatTools,
  anthropicToChatToolChoice,
  anthropicToOptions,
  finishToStopReason,
  buildAnthropicMessage,
  internalToAnthropic,
  AnthropicStreamEncoder,
  type AnthropicRequest,
} from '../../lib/anthropic-translate.js';
import type { ChatCompletionChunk } from '@freellmapi/shared/types.js';

function req(partial: Partial<AnthropicRequest>): AnthropicRequest {
  return { max_tokens: 1024, messages: [], ...partial } as AnthropicRequest;
}

describe('Anthropic schema', () => {
  it('rejects a request missing max_tokens (Anthropic requires it)', () => {
    const parsed = anthropicMessagesSchema.safeParse({ messages: [{ role: 'user', content: 'hi' }] });
    expect(parsed.success).toBe(false);
  });
  it('accepts a minimal valid request', () => {
    const parsed = anthropicMessagesSchema.safeParse({ max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
    expect(parsed.success).toBe(true);
  });
});

describe('Anthropic → internal chat messages', () => {
  it('maps a plain string user message', () => {
    expect(anthropicToChatMessages(req({ messages: [{ role: 'user', content: 'hello' }] }))).toEqual([
      { role: 'user', content: 'hello' },
    ]);
  });

  it('prepends a string system prompt as a system message', () => {
    const msgs = anthropicToChatMessages(req({ system: 'You are terse.', messages: [{ role: 'user', content: 'hi' }] }));
    expect(msgs[0]).toEqual({ role: 'system', content: 'You are terse.' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('joins a block-array system prompt', () => {
    const msgs = anthropicToChatMessages(req({
      system: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] as any,
      messages: [{ role: 'user', content: 'hi' }],
    }));
    expect(msgs[0]).toEqual({ role: 'system', content: 'ab' });
  });

  it('maps an assistant tool_use block to tool_calls', () => {
    const msgs = anthropicToChatMessages(req({
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me check' },
          { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'SF' } },
        ],
      }] as any,
    }));
    expect(msgs[0]).toEqual({
      role: 'assistant',
      content: 'let me check',
      tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }],
    });
  });

  it('maps a user tool_result block to a standalone tool message, emitted before user text', () => {
    const msgs = anthropicToChatMessages(req({
      messages: [{
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'sunny' },
          { type: 'text', text: 'thanks' },
        ],
      }] as any,
    }));
    expect(msgs[0]).toEqual({ role: 'tool', tool_call_id: 'tu_1', content: 'sunny' });
    expect(msgs[1]).toEqual({ role: 'user', content: 'thanks' });
  });

  it('maps a base64 image block to an image_url data URL', () => {
    const msgs = anthropicToChatMessages(req({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        ],
      }] as any,
    }));
    expect(msgs[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    });
  });
});

describe('Anthropic → internal tools / options', () => {
  it('maps tools (input_schema → parameters)', () => {
    const tools = anthropicToChatTools([{ name: 'f', description: 'd', input_schema: { type: 'object' } }] as any);
    expect(tools).toEqual([{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }]);
  });

  it('maps tool_choice forms (any → required, tool → function)', () => {
    expect(anthropicToChatToolChoice({ type: 'auto' } as any)).toBe('auto');
    expect(anthropicToChatToolChoice({ type: 'any' } as any)).toBe('required');
    expect(anthropicToChatToolChoice({ type: 'none' } as any)).toBe('none');
    expect(anthropicToChatToolChoice({ type: 'tool', name: 'f' } as any)).toEqual({ type: 'function', function: { name: 'f' } });
    expect(anthropicToChatToolChoice(undefined)).toBeUndefined();
  });

  it('carries max_tokens + stop_sequences into options', () => {
    const opts = anthropicToOptions(req({ max_tokens: 256, stop_sequences: ['STOP'], temperature: 0.5 }));
    expect(opts.max_tokens).toBe(256);
    expect(opts.stop).toEqual(['STOP']);
    expect(opts.temperature).toBe(0.5);
  });
});

describe('finish_reason → stop_reason', () => {
  it('maps the table + tool override', () => {
    expect(finishToStopReason('stop', false)).toBe('end_turn');
    expect(finishToStopReason('length', false)).toBe('max_tokens');
    expect(finishToStopReason('tool_calls', false)).toBe('tool_use');
    expect(finishToStopReason('content_filter', false)).toBe('end_turn');
    expect(finishToStopReason(null, false)).toBe('end_turn');
    expect(finishToStopReason('stop', true)).toBe('tool_use'); // tool calls present overrides
  });
});

describe('internal → Anthropic message object', () => {
  it('builds a text content block + usage', () => {
    const m = buildAnthropicMessage({ id: 'msg_1', model: 'm', text: 'hi there', toolCalls: [], stopReason: 'end_turn', inputTokens: 5, outputTokens: 2 });
    expect(m.type).toBe('message');
    expect(m.role).toBe('assistant');
    expect(m.content).toEqual([{ type: 'text', text: 'hi there' }]);
    expect(m.stop_reason).toBe('end_turn');
    expect(m.usage).toEqual({ input_tokens: 5, output_tokens: 2 });
  });

  it('emits tool_use blocks with parsed input', () => {
    const m = buildAnthropicMessage({
      id: 'msg_1', model: 'm', text: '',
      toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }],
      stopReason: 'tool_use', inputTokens: 1, outputTokens: 1,
    });
    expect(m.content).toEqual([{ type: 'tool_use', id: 'call_1', name: 'f', input: { a: 1 } }]);
  });

  it('internalToAnthropic derives stop_reason + usage from a ChatCompletionResponse', () => {
    const m = internalToAnthropic({
      id: 'c', object: 'chat.completion', created: 0, model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content: 'yo' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    } as any, 'm', 'msg_1');
    expect(m.content).toEqual([{ type: 'text', text: 'yo' }]);
    expect(m.stop_reason).toBe('end_turn');
    expect(m.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
  });
});

describe('AnthropicStreamEncoder', () => {
  function chunk(delta: any, finish: string | null = null): ChatCompletionChunk {
    return { id: 'c', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] };
  }

  it('emits the canonical text streaming sequence', () => {
    const enc = new AnthropicStreamEncoder({ id: 'msg_1', model: 'm', inputTokens: 5 });
    const frames = [
      ...enc.start(),
      ...enc.chunk(chunk({ role: 'assistant', content: 'Hel' })),
      ...enc.chunk(chunk({ content: 'lo' })),
      ...enc.chunk(chunk({}, 'stop')),
      ...enc.finish(),
    ].join('');
    for (const ev of ['message_start', 'ping', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']) {
      expect(frames).toContain(`event: ${ev}`);
    }
    expect(frames).toContain('"type":"text_delta","text":"Hel"');
    expect(frames).toContain('"type":"text_delta","text":"lo"');
    expect(frames).toContain('"stop_reason":"end_turn"');
  });

  it('emits tool_use blocks with input_json_delta and a tool_use stop_reason', () => {
    const enc = new AnthropicStreamEncoder({ id: 'msg_1', model: 'm', inputTokens: 1 });
    const frames = [
      ...enc.start(),
      ...enc.chunk(chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"ci' } }] })),
      ...enc.chunk(chunk({ tool_calls: [{ index: 0, type: 'function', function: { arguments: 'ty":"SF"}' } }] }, 'tool_calls')),
      ...enc.finish(),
    ].join('');
    expect(frames).toContain('"type":"tool_use"');
    expect(frames).toContain('"name":"get_weather"');
    expect(frames).toContain('"type":"input_json_delta","partial_json":"{\\"ci"');
    expect(frames).toContain('"type":"input_json_delta","partial_json":"ty\\":\\"SF\\"}"');
    expect(frames).toContain('"stop_reason":"tool_use"');
  });

  it('closes the open text block before opening a tool block', () => {
    const enc = new AnthropicStreamEncoder({ id: 'msg_1', model: 'm', inputTokens: 1 });
    enc.start();
    const textFrames = enc.chunk(chunk({ content: 'thinking' })).join('');
    expect(textFrames).toContain('"index":0');
    const toolFrames = enc.chunk(chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] })).join('');
    // text block 0 stops, tool block opens at index 1
    expect(toolFrames).toContain('content_block_stop');
    expect(toolFrames).toContain('"index":1');
  });
});
