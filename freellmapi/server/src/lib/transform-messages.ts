import type { ChatMessage, ChatContentBlock } from '@freellmapi/shared/types.js';
import { contentToString } from './content.js';
import { compressToolOutput } from './rtk.js';

// Per-request message transforms applied AFTER the internal ChatMessage[] is built
// and BEFORE token estimation / routing, so savings reflect in routing + logs.
//   - tokenSaver: RTK-compress bulky tool output (git diff / grep / ls / build logs)
//   - terse/caveman: inject a brevity system prompt to cut output tokens
// Pure + DB-free (unit-testable without Postgres).

export type TerseLevel = 'lite' | 'full' | 'ultra';
export interface TransformOptions {
  tokenSaver?: boolean;
  terseMode?: boolean;
  terseLevel?: TerseLevel;
}

// Caveman intensity prompts (ported from 9router open-sse/rtk/cavemanPrompts.js,
// adapted from the caveman skill — https://github.com/JuliusBrussee/caveman).
const SHARED_BOUNDARIES = 'Code blocks, file paths, commands, errors, URLs: keep exact. Security warnings, irreversible action confirmations, multi-step ordered sequences: write normal. Resume terse style after.';
const CAVEMAN_PROMPTS: Record<TerseLevel, string> = {
  lite: [
    'Respond tersely. Keep grammar and full sentences but drop filler, hedging and pleasantries (just/really/basically/sure/of course/I\'d be happy to).',
    'Pattern: state the thing, the action, the reason. Then next step.',
    SHARED_BOUNDARIES,
    'Active every response until user asks for normal mode.',
  ].join(' '),
  full: [
    'Respond like terse caveman. All technical substance stay exact, only fluff die.',
    'Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries, hedging. Fragments OK. Short synonyms (big not extensive, fix not implement a solution for).',
    'Pattern: [thing] [action] [reason]. [next step].',
    SHARED_BOUNDARIES,
    'Active every response until user asks for normal mode.',
  ].join(' '),
  ultra: [
    'Respond ultra-terse. Maximum compression. Telegraphic.',
    'Abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, use arrows for causality (X → Y). One word when one word enough.',
    'Pattern: [thing] → [result]. [fix].',
    SHARED_BOUNDARIES,
    'Active every response until user asks for normal mode.',
  ].join(' '),
};

export interface TransformResult {
  messages: ChatMessage[];
  saved: number; // bytes removed by the token saver
  hits: number;  // number of tool outputs compressed
}

// Compress a single message's content if it carries tool output. Returns the new
// content + bytes saved. Targets role:'tool' messages (string or text-block array)
// and any `tool_result` block (mirrors the shapes RTK handles).
function compressMessageContent(m: ChatMessage): { content: ChatMessage['content']; saved: number; hit: boolean } {
  let saved = 0, hit = false;

  if (m.role === 'tool') {
    if (typeof m.content === 'string') {
      const r = compressToolOutput(m.content);
      if (r.filter) { saved += r.saved; hit = true; }
      return { content: r.text, saved, hit };
    }
    if (Array.isArray(m.content)) {
      const blocks = m.content.map((b): ChatContentBlock => {
        if (b && (b as { type?: string }).type === 'text' && typeof (b as { text?: string }).text === 'string') {
          const r = compressToolOutput((b as { text: string }).text);
          if (r.filter) { saved += r.saved; hit = true; }
          return { ...b, text: r.text };
        }
        return b;
      });
      return { content: blocks, saved, hit };
    }
    return { content: m.content, saved, hit };
  }

  // Non-tool message that still carries tool_result blocks (defensive).
  if (Array.isArray(m.content)) {
    const blocks = m.content.map((b): ChatContentBlock => {
      const block = b as { type?: string; is_error?: boolean; content?: unknown; text?: string };
      if (block?.type === 'tool_result' && block.is_error !== true && typeof block.content === 'string') {
        const r = compressToolOutput(block.content);
        if (r.filter) { saved += r.saved; hit = true; }
        return { ...b, content: r.text } as ChatContentBlock;
      }
      return b;
    });
    return { content: blocks, saved, hit };
  }

  return { content: m.content, saved, hit };
}

export function transformMessages(messages: ChatMessage[], opts: TransformOptions): TransformResult {
  let out = messages;
  let saved = 0, hits = 0;

  if (opts.tokenSaver) {
    out = out.map((m) => {
      const r = compressMessageContent(m);
      if (r.hit) { saved += r.saved; hits += 1; return { ...m, content: r.content }; }
      return m;
    });
  }

  if (opts.terseMode) {
    const level: TerseLevel = opts.terseLevel ?? 'full';
    const prompt = CAVEMAN_PROMPTS[level] ?? CAVEMAN_PROMPTS.full;
    const firstSystemIdx = out.findIndex(m => m.role === 'system');
    if (firstSystemIdx === -1) {
      out = [{ role: 'system', content: prompt }, ...out];
    } else {
      out = out.map((m, i) => {
        if (i !== firstSystemIdx) return m;
        const base = contentToString(m.content);
        return { ...m, content: base.length > 0 ? `${base}\n\n${prompt}` : prompt };
      });
    }
  }

  return { messages: out, saved, hits };
}
