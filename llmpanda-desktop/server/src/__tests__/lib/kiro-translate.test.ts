import { describe, it, expect } from 'vitest';
import { buildConversationState, decodeEventStream, eventText } from '../../lib/kiro-translate.js';
import type { ChatMessage } from '@freellmapi/shared/types.js';

// Build a synthetic AWS EventStream frame (CRCs zeroed — decoder ignores them).
function frame(eventType: string, payload: object): Uint8Array {
  const nameBuf = Buffer.from(':event-type');
  const valueBuf = Buffer.from(eventType);
  const header = Buffer.concat([
    Buffer.from([nameBuf.length]), nameBuf,
    Buffer.from([7]),
    Buffer.from([(valueBuf.length >> 8) & 0xff, valueBuf.length & 0xff]), valueBuf,
  ]);
  const payloadBuf = Buffer.from(JSON.stringify(payload));
  const total = 12 + header.length + payloadBuf.length + 4;
  const out = Buffer.alloc(total);
  out.writeUInt32BE(total, 0);
  out.writeUInt32BE(header.length, 4);
  out.writeUInt32BE(0, 8);
  header.copy(out, 12);
  payloadBuf.copy(out, 12 + header.length);
  out.writeUInt32BE(0, total - 4);
  return new Uint8Array(out);
}

describe('Kiro EventStream decoder', () => {
  it('decodes a single assistantResponseEvent frame', () => {
    const { events, rest } = decodeEventStream(frame('assistantResponseEvent', { content: 'Hello' }));
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('assistantResponseEvent');
    expect(eventText(events[0])).toBe('Hello');
    expect(rest.length).toBe(0);
  });

  it('decodes multiple concatenated frames', () => {
    const a = frame('assistantResponseEvent', { content: 'foo ' });
    const b = frame('assistantResponseEvent', { content: 'bar' });
    const buf = new Uint8Array(a.length + b.length);
    buf.set(a); buf.set(b, a.length);
    const { events } = decodeEventStream(buf);
    expect(events.map(eventText).join('')).toBe('foo bar');
  });

  it('keeps a partial trailing frame as rest', () => {
    const full = frame('assistantResponseEvent', { content: 'hi' });
    const partial = full.slice(0, full.length - 5); // chop the tail
    const { events, rest } = decodeEventStream(partial);
    expect(events).toHaveLength(0);
    expect(rest.length).toBe(partial.length);
  });
});

describe('Kiro conversationState builder', () => {
  it('puts the last user message in currentMessage and the rest in history', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    const cs = buildConversationState(msgs, 'claude-sonnet-4.5');
    expect(cs.conversationState.currentMessage.userInputMessage.content).toBe('second');
    expect(cs.conversationState.history).toHaveLength(2);
    expect(cs.conversationState.chatTriggerType).toBe('MANUAL');
  });

  it('prepends the system prompt to the first user message', () => {
    const cs = buildConversationState([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'hi' },
    ], 'm');
    expect(cs.conversationState.currentMessage.userInputMessage.content).toContain('You are terse.');
    expect(cs.conversationState.currentMessage.userInputMessage.content).toContain('hi');
  });

  it('maps assistant tool_calls + tool results', () => {
    const cs = buildConversationState([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'tu1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] },
      { role: 'tool', content: 'sunny', tool_call_id: 'tu1' },
      { role: 'user', content: 'thanks' },
    ], 'm');
    const hist = cs.conversationState.history as any[];
    const asst = hist.find(h => h.assistantResponseMessage);
    expect(asst.assistantResponseMessage.toolUses[0]).toMatchObject({ toolUseId: 'tu1', name: 'get_weather', input: { city: 'SF' } });
    const toolUser = hist.find(h => h.userInputMessage?.userInputMessageContext?.toolResults);
    expect(toolUser.userInputMessage.userInputMessageContext.toolResults[0].toolUseId).toBe('tu1');
  });

  it('attaches tools to the first user message context', () => {
    const cs = buildConversationState([{ role: 'user', content: 'hi' }], 'm', [
      { type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object', properties: { x: { type: 'string' } } } } },
    ]);
    // single user → becomes currentMessage; tools live on its context
    const tools = cs.conversationState.currentMessage.userInputMessage.userInputMessageContext?.tools as any[];
    expect(tools[0].toolSpecification.name).toBe('f');
  });
});
