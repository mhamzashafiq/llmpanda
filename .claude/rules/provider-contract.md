---
description: "Provider adapter contract for FreeLLMAPI"
globs: "server/src/providers/**"
---

# Provider contract (`server/src/providers/**`)

Every provider adapter in `server/src/providers/` MUST satisfy this contract. See the
`.claude/skills/add-provider` skill for the full procedure.

- **Implements both methods:** `chatCompletion()` (non-streaming) AND `streamChatCompletion()`
  (SSE streaming), against the Provider base class (`base.ts`). Both paths must work.
- **Declares supported endpoints/models** it serves.
- **Registers in `index.ts`** — the adapter must be wired into `server/src/providers/index.ts` so
  the router can resolve it.
- **Seeds its models** in `server/src/db/index.ts`.
- **Ships a test** in `server/src/__tests__/providers/` covering streaming and non-streaming;
  `npm test` stays green.
- **Never logs or returns upstream provider keys.** Decryption is in-memory only.
