import { describe, it, expect } from 'vitest';
import { transformMessages } from '../../lib/transform-messages.js';
import type { ChatMessage } from '@freellmapi/shared/types.js';

function bigGrep(): string {
  const lines: string[] = [];
  for (let f = 0; f < 3; f++) for (let n = 0; n < 40; n++) lines.push(`src/file${f}.ts:${n}:  matching code content ${n}`);
  return lines.join('\n');
}

describe('transformMessages — token saver', () => {
  it('compresses a tool-role message and reports savings', () => {
    const dump = bigGrep();
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'run grep' },
      { role: 'tool', content: dump, tool_call_id: 'call_1', name: 'grep' },
    ];
    const r = transformMessages(msgs, { tokenSaver: true });
    expect(r.hits).toBe(1);
    expect(r.saved).toBeGreaterThan(0);
    const tool = r.messages[1];
    expect(tool.role).toBe('tool');
    expect(tool.tool_call_id).toBe('call_1');
    expect(tool.name).toBe('grep');
    expect(typeof tool.content === 'string' && tool.content.length).toBeLessThan(dump.length);
  });

  it('leaves non-tool messages untouched', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: bigGrep() }];
    const r = transformMessages(msgs, { tokenSaver: true });
    expect(r.hits).toBe(0);
    expect(r.messages[0].content).toBe(msgs[0].content);
  });

  it('does nothing when tokenSaver is off', () => {
    const dump = bigGrep();
    const r = transformMessages([{ role: 'tool', content: dump, tool_call_id: 'c' }], {});
    expect(r.hits).toBe(0);
    expect(r.messages[0].content).toBe(dump);
  });

  it('compresses tool content given as text blocks', () => {
    const dump = bigGrep();
    const msgs: ChatMessage[] = [{ role: 'tool', content: [{ type: 'text', text: dump }], tool_call_id: 'c' }];
    const r = transformMessages(msgs, { tokenSaver: true });
    expect(r.hits).toBe(1);
    const blocks = r.messages[0].content as Array<{ type: string; text: string }>;
    expect(blocks[0].text.length).toBeLessThan(dump.length);
  });
});

describe('transformMessages — terse/caveman mode', () => {
  it('prepends a system message when none exists', () => {
    const r = transformMessages([{ role: 'user', content: 'hi' }], { terseMode: true });
    expect(r.messages[0].role).toBe('system');
    expect(String(r.messages[0].content)).toContain('terse');
    expect(r.messages[1].content).toBe('hi');
  });

  it('appends to an existing system message (preserving it)', () => {
    const r = transformMessages([
      { role: 'system', content: 'You are a coding agent.' },
      { role: 'user', content: 'hi' },
    ], { terseMode: true, terseLevel: 'ultra' });
    expect(r.messages[0].role).toBe('system');
    expect(String(r.messages[0].content)).toContain('You are a coding agent.');
    expect(String(r.messages[0].content)).toContain('ultra-terse');
  });

  it('uses the requested level', () => {
    const r = transformMessages([{ role: 'user', content: 'hi' }], { terseMode: true, terseLevel: 'lite' });
    expect(String(r.messages[0].content)).toContain('Respond tersely');
  });
});
