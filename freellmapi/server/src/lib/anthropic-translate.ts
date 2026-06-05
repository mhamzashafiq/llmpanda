import { z } from 'zod';
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
  ChatToolChoice,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '@freellmapi/shared/types.js';
import type { CompletionOptions } from '../providers/base.js';
import { contentToString } from './content.js';

// ─────────────────────────────────────────────────────────────────────────
// Anthropic Messages API (POST /v1/messages) ⇄ internal chat format.
//
// Claude Code (and any Anthropic-SDK client) speaks the Messages API, not the
// OpenAI chat-completions wire. This module is pure + DB-free so it can be unit
// tested without a Postgres pool (mirrors lib/content.ts + the responses
// translators). The route (routes/messages.ts) owns auth, routing and I/O; this
// file only maps shapes.
// ─────────────────────────────────────────────────────────────────────────

// ── Request schema ────────────────────────────────────────────────────────
// Lenient on purpose: the Messages surface is large + evolving. We consume the
// fields we can map; unknown fields (cache_control, thinking, metadata, …) are
// accepted via .passthrough() and ignored.

const textBlockSchema = z.object({ type: z.literal('text'), text: z.string() }).passthrough();

const imageSourceSchema = z.object({
  type: z.string(), // 'base64' | 'url'
  media_type: z.string().optional(),
  data: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

const imageBlockSchema = z.object({
  type: z.literal('image'),
  source: imageSourceSchema,
}).passthrough();

const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(),
  is_error: z.boolean().optional(),
}).passthrough();

// Any other block type validates but is dropped during translation.
const anyBlockSchema = z.object({ type: z.string() }).passthrough();

const contentBlockSchema = z.union([
  textBlockSchema,
  imageBlockSchema,
  toolUseBlockSchema,
  toolResultBlockSchema,
  anyBlockSchema,
]);

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
});

const anthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

const anthropicToolChoiceSchema = z.union([
  z.object({ type: z.enum(['auto', 'any', 'none']) }).passthrough(),
  z.object({ type: z.literal('tool'), name: z.string() }).passthrough(),
]);

export const anthropicMessagesSchema = z.object({
  model: z.string().optional(),
  messages: z.array(messageSchema),
  system: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
  // max_tokens is REQUIRED by the Anthropic API — enforce it so a missing field
  // is a clean 400 rather than an undefined downstream.
  max_tokens: z.number().int().positive(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(1).nullable().optional(),
  top_p: z.number().min(0).max(1).nullable().optional(),
  stop_sequences: z.array(z.string()).optional(),
  tools: z.array(anthropicToolSchema).optional(),
  tool_choice: anthropicToolChoiceSchema.optional(),
}).passthrough();

export type AnthropicRequest = z.infer<typeof anthropicMessagesSchema>;
type AnthropicContentBlock = z.infer<typeof contentBlockSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────

// Join the text of a block array (used for `system` and tool_result content).
function blocksToText(blocks: unknown): string {
  if (typeof blocks === 'string') return blocks;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (b && (b as { type?: string }).type === 'text' ? ((b as { text?: string }).text ?? '') : ''))
    .join('');
}

// Anthropic image block → an OpenAI-style image_url URL, or null if unusable.
function imageBlockToUrl(block: z.infer<typeof imageBlockSchema>): string | null {
  const src = block.source;
  if (src.type === 'base64' && src.data) {
    return `data:${src.media_type ?? 'image/png'};base64,${src.data}`;
  }
  if (src.type === 'url' && src.url) return src.url;
  // Some clients send the data URL directly under `url` regardless of type.
  if (src.url) return src.url;
  return null;
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── Request → internal chat messages ──────────────────────────────────────
export function anthropicToChatMessages(req: AnthropicRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (req.system != null) {
    const sys = typeof req.system === 'string' ? req.system : blocksToText(req.system);
    if (sys.length > 0) messages.push({ role: 'system', content: sys });
  }

  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content });
      continue;
    }

    if (m.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: ChatToolCall[] = [];
      for (const b of m.content) {
        const type = (b as { type?: string }).type;
        if (type === 'text') {
          textParts.push((b as { text?: string }).text ?? '');
        } else if (type === 'tool_use') {
          const tu = b as z.infer<typeof toolUseBlockSchema>;
          toolCalls.push({
            id: tu.id,
            type: 'function',
            function: { name: tu.name, arguments: JSON.stringify(tu.input ?? {}) },
          });
        }
        // other block types dropped
      }
      const text = textParts.join('');
      const content: ChatMessage['content'] = text.length > 0
        ? text
        : (toolCalls.length > 0 ? null : '');
      messages.push({
        role: 'assistant',
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // user turn: tool_result blocks become standalone `tool` messages (emitted
    // first, as OpenAI requires); remaining text/image blocks become a user
    // message.
    const toolMessages: ChatMessage[] = [];
    const userBlocks: Array<{ type: string; [k: string]: unknown }> = [];
    for (const b of m.content) {
      const type = (b as { type?: string }).type;
      if (type === 'tool_result') {
        const tr = b as z.infer<typeof toolResultBlockSchema>;
        toolMessages.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: blocksToText(tr.content ?? ''),
        });
      } else if (type === 'text') {
        userBlocks.push({ type: 'text', text: (b as { text?: string }).text ?? '' });
      } else if (type === 'image') {
        const url = imageBlockToUrl(b as z.infer<typeof imageBlockSchema>);
        if (url) userBlocks.push({ type: 'image_url', image_url: { url } });
      }
    }
    for (const tm of toolMessages) messages.push(tm);
    if (userBlocks.length > 0) {
      const onlyText = userBlocks.length === 1 && userBlocks[0].type === 'text';
      messages.push({
        role: 'user',
        content: onlyText ? String(userBlocks[0].text ?? '') : (userBlocks as ChatMessage['content']),
      });
    }
  }

  return messages;
}

export function anthropicToChatTools(tools?: AnthropicRequest['tools']): ChatToolDefinition[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.input_schema ? { parameters: t.input_schema } : {}),
    },
  }));
}

export function anthropicToChatToolChoice(tc?: AnthropicRequest['tool_choice']): ChatToolChoice | undefined {
  if (!tc) return undefined;
  switch (tc.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'none': return 'none';
    case 'tool': return { type: 'function', function: { name: (tc as { name: string }).name } };
    default: return undefined;
  }
}

export function anthropicToOptions(req: AnthropicRequest): CompletionOptions {
  return {
    temperature: req.temperature ?? undefined,
    max_tokens: req.max_tokens,
    top_p: req.top_p ?? undefined,
    tools: anthropicToChatTools(req.tools),
    tool_choice: anthropicToChatToolChoice(req.tool_choice),
    ...(req.stop_sequences?.length ? { stop: req.stop_sequences } : {}),
  };
}

export function anthropicToInternal(req: AnthropicRequest): {
  model?: string;
  messages: ChatMessage[];
  options: CompletionOptions;
} {
  return {
    model: req.model,
    messages: anthropicToChatMessages(req),
    options: anthropicToOptions(req),
  };
}

// ── finish_reason → Anthropic stop_reason ─────────────────────────────────
export function finishToStopReason(finishReason: string | null | undefined, hasToolCalls: boolean): string {
  if (hasToolCalls) return 'tool_use';
  switch (finishReason) {
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    case 'content_filter': return 'end_turn';
    case 'stop':
    default: return 'end_turn';
  }
}

// ── Internal (non-stream) → Anthropic message object ──────────────────────
export interface AnthropicContentOut {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export function buildAnthropicMessage(opts: {
  id: string;
  model: string;
  text: string;
  toolCalls: ChatToolCall[];
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}) {
  const content: AnthropicContentOut[] = [];
  if (opts.text.length > 0) content.push({ type: 'text', text: opts.text });
  for (const tc of opts.toolCalls) {
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input: safeParseJson(tc.function.arguments),
    });
  }
  return {
    id: opts.id,
    type: 'message' as const,
    role: 'assistant' as const,
    model: opts.model,
    content,
    stop_reason: opts.stopReason,
    stop_sequence: null,
    usage: { input_tokens: opts.inputTokens, output_tokens: opts.outputTokens },
  };
}

export function internalToAnthropic(result: ChatCompletionResponse, model: string, id: string) {
  const msg = result.choices?.[0]?.message;
  const text = contentToString(msg?.content ?? '');
  const toolCalls = msg?.tool_calls ?? [];
  const finishReason = result.choices?.[0]?.finish_reason ?? null;
  const inputTokens = result.usage?.prompt_tokens ?? 0;
  const outputTokens = result.usage?.completion_tokens ?? Math.ceil(text.length / 4);
  return buildAnthropicMessage({
    id,
    model,
    text,
    toolCalls,
    stopReason: finishToStopReason(finishReason, toolCalls.length > 0),
    inputTokens,
    outputTokens,
  });
}

// ── Streaming: internal chunks → Anthropic SSE event frames ────────────────
// The provider yields OpenAI-style ChatCompletionChunks (text deltas + tool
// argument fragments). Anthropic's wire is an ordered block stream: each block
// must be opened (content_block_start), filled (content_block_delta) and closed
// (content_block_stop) before the next opens. This encoder translates between
// the two. It is stateful and DB-free so the route can drive it and the tests
// can assert the exact frame sequence.

function frame(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

export class AnthropicStreamEncoder {
  private blockIndex = -1;
  private openType: 'text' | 'tool' | null = null;
  private toolBlocks = new Map<number, number>(); // provider tool index → our block index
  private finishReason: string | null = null;
  private toolOpened = false;
  outputTokens = 0;

  constructor(private ctx: { id: string; model: string; inputTokens: number }) {}

  start(): string[] {
    const message = {
      id: this.ctx.id,
      type: 'message',
      role: 'assistant',
      model: this.ctx.model,
      content: [] as unknown[],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: this.ctx.inputTokens, output_tokens: 0 },
    };
    return [frame('message_start', { message }), frame('ping', {})];
  }

  private closeOpen(out: string[]): void {
    if (this.openType !== null) {
      out.push(frame('content_block_stop', { index: this.blockIndex }));
      this.openType = null;
    }
  }

  chunk(c: ChatCompletionChunk): string[] {
    const out: string[] = [];
    const choice = c.choices?.[0];
    if (!choice) return out;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;

    const delta = choice.delta ?? {};
    const text = typeof delta.content === 'string' ? delta.content : '';
    if (text) {
      if (this.openType !== 'text') {
        this.closeOpen(out);
        this.blockIndex++;
        out.push(frame('content_block_start', {
          index: this.blockIndex,
          content_block: { type: 'text', text: '' },
        }));
        this.openType = 'text';
      }
      out.push(frame('content_block_delta', {
        index: this.blockIndex,
        delta: { type: 'text_delta', text },
      }));
      this.outputTokens += Math.ceil(text.length / 4);
    }

    for (const tc of delta.tool_calls ?? []) {
      const pidx = (tc as { index?: number }).index ?? 0;
      if (!this.toolBlocks.has(pidx)) {
        this.closeOpen(out);
        this.blockIndex++;
        this.toolBlocks.set(pidx, this.blockIndex);
        this.toolOpened = true;
        this.openType = 'tool';
        out.push(frame('content_block_start', {
          index: this.blockIndex,
          content_block: {
            type: 'tool_use',
            id: tc.id || `toolu_${this.ctx.id}_${pidx}`,
            name: tc.function?.name ?? '',
            input: {},
          },
        }));
      }
      const argFrag = tc.function?.arguments ?? '';
      if (argFrag) {
        out.push(frame('content_block_delta', {
          index: this.toolBlocks.get(pidx)!,
          delta: { type: 'input_json_delta', partial_json: argFrag },
        }));
        this.outputTokens += Math.ceil(argFrag.length / 4);
      }
    }

    return out;
  }

  finish(): string[] {
    const out: string[] = [];
    this.closeOpen(out);
    const stopReason = finishToStopReason(this.finishReason, this.toolOpened);
    out.push(frame('message_delta', {
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    }));
    out.push(frame('message_stop', {}));
    return out;
  }

  // Mid-stream provider failure: emit an `error` event so the client sees a real
  // signal instead of a silently truncated stream.
  error(message: string): string[] {
    return [frame('error', { error: { type: 'api_error', message } })];
  }
}
