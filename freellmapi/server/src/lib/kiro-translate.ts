import crypto from 'crypto';
import type { ChatMessage, ChatToolDefinition } from '@freellmapi/shared/types.js';
import { contentToString } from './content.js';

// Kiro (AWS CodeWhisperer) translation — internal chat ⇄ CodeWhisperer
// conversationState + the AWS EventStream binary response decoder. Pure + DB-free
// (unit-testable). Ported from 9router (MIT). The provider (providers/kiro.ts)
// uses these; the OAuth/token side lives in lib/oauth/kiro.ts.

// ── request: ChatMessage[] → CodeWhisperer conversationState ─────────────────
interface CwTool { toolSpecification: { name: string; description: string; inputSchema: { json: Record<string, unknown> } } }
interface CwUser { userInputMessage: { content: string; modelId: string; userInputMessageContext?: { tools?: CwTool[]; toolResults?: Array<{ toolUseId?: string; status: string; content: Array<{ text: string }> }> } } }
interface CwAssistant { assistantResponseMessage: { content: string; toolUses?: Array<{ toolUseId: string; name: string; input: Record<string, unknown> }> } }
type CwItem = CwUser | CwAssistant;

function safeParseObj(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export function buildConversationState(messages: ChatMessage[], modelId: string, tools?: ChatToolDefinition[]) {
  const sys = messages.filter(m => m.role === 'system').map(m => contentToString(m.content)).filter(Boolean).join('\n\n');
  const items: CwItem[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;
    const content = contentToString(m.content);
    if (m.role === 'tool') {
      items.push({ userInputMessage: { content: '', modelId, userInputMessageContext: { toolResults: [{ toolUseId: m.tool_call_id, status: 'success', content: [{ text: content }] }] } } });
    } else if (m.role === 'user') {
      items.push({ userInputMessage: { content: content || 'continue', modelId } });
    } else if (m.role === 'assistant') {
      const a: CwAssistant = { assistantResponseMessage: { content: content || '' } };
      if (m.tool_calls?.length) {
        a.assistantResponseMessage.toolUses = m.tool_calls.map(tc => ({ toolUseId: tc.id, name: tc.function.name, input: safeParseObj(tc.function.arguments) }));
      }
      items.push(a);
    }
  }

  const firstUser = items.find((i): i is CwUser => 'userInputMessage' in i);
  if (sys && firstUser) firstUser.userInputMessage.content = `${sys}\n\n${firstUser.userInputMessage.content}`.trim();
  if (tools?.length && firstUser) {
    const ctx = firstUser.userInputMessage.userInputMessageContext ?? {};
    ctx.tools = tools.map(t => {
      const schema = t.function.parameters && Object.keys(t.function.parameters).length ? t.function.parameters : { type: 'object', properties: {}, required: [] };
      return { toolSpecification: { name: t.function.name, description: t.function.description || `Tool: ${t.function.name}`, inputSchema: { json: { required: [], ...(schema as Record<string, unknown>) } } } };
    });
    firstUser.userInputMessage.userInputMessageContext = ctx;
  }

  // Last userInputMessage becomes currentMessage; the rest is history.
  let currentMessage: CwUser | undefined;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if ('userInputMessage' in it) { currentMessage = it; items.splice(i, 1); break; }
  }
  if (!currentMessage) currentMessage = { userInputMessage: { content: 'continue', modelId } };

  return {
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: crypto.randomUUID(),
      currentMessage,
      history: items,
    },
  };
}

// ── response: AWS EventStream binary frames → events ─────────────────────────
// Frame layout: [totalLen u32][headersLen u32][prelude crc u32][headers][payload][msg crc u32].
// Header: [nameLen u8][name][type u8][...]. We only need string headers (type 7):
// [valueLen u16][value]. CRCs are ignored (decode, not validate) — matches 9router.
export interface KiroEvent { eventType: string; payload: Record<string, unknown> | null }

function parseFrame(data: Uint8Array): KiroEvent | null {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headersLength = view.getUint32(4, false);
    const headers: Record<string, string> = {};
    let offset = 12;
    const headerEnd = 12 + headersLength;
    while (offset < headerEnd && offset < data.length) {
      const nameLen = data[offset]; offset++;
      if (offset + nameLen > data.length) break;
      const name = new TextDecoder().decode(data.slice(offset, offset + nameLen)); offset += nameLen;
      const headerType = data[offset]; offset++;
      if (headerType === 7) {
        const valueLen = (data[offset] << 8) | data[offset + 1]; offset += 2;
        if (offset + valueLen > data.length) break;
        headers[name] = new TextDecoder().decode(data.slice(offset, offset + valueLen)); offset += valueLen;
      } else break;
    }
    const payloadStart = 12 + headersLength;
    const payloadEnd = data.length - 4;
    let payload: Record<string, unknown> | null = null;
    if (payloadEnd > payloadStart) {
      const str = new TextDecoder().decode(data.slice(payloadStart, payloadEnd));
      if (str.trim()) { try { payload = JSON.parse(str); } catch { payload = { raw: str }; } }
    }
    return { eventType: headers[':event-type'] || '', payload };
  } catch {
    return null;
  }
}

// Incrementally decode whatever complete frames are in `buffer`; return the
// decoded events + the leftover bytes (a partial frame) for the next chunk.
export function decodeEventStream(buffer: Uint8Array): { events: KiroEvent[]; rest: Uint8Array } {
  const events: KiroEvent[] = [];
  let buf = buffer;
  let guard = 0;
  while (buf.length >= 16 && guard++ < 100000) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const totalLength = view.getUint32(0, false);
    if (totalLength < 16 || totalLength > buf.length) break;
    const frame = buf.slice(0, totalLength);
    buf = buf.slice(totalLength);
    const ev = parseFrame(frame);
    if (ev) events.push(ev);
  }
  return { events, rest: buf };
}

// Pull the assistant text delta out of a decoded event (assistantResponseEvent).
export function eventText(ev: KiroEvent): string {
  if (ev.eventType === 'assistantResponseEvent' && ev.payload && typeof ev.payload.content === 'string') {
    return ev.payload.content;
  }
  return '';
}
