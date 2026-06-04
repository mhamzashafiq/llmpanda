---
name: add-provider
description: "Use when adding a new LLM provider/adapter to FreeLLMAPI — implementing a new provider's chatCompletion + streaming, wiring it into the registry, seeding its models, and testing it."
---

# Add a Provider to FreeLLMAPI

Follow these steps to add a new LLM provider adapter. Adapters live in
`server/src/providers/`; the registry is `server/src/providers/index.ts`.

## Steps

1. **Copy the template.** Start from `server/src/providers/openai-compat.ts` — it is the canonical
   OpenAI-compatible adapter. Copy it to `server/src/providers/<provider>.ts`. If the provider's
   API is OpenAI-shaped, you may be able to configure `openai-compat` directly instead of forking.

2. **Implement the contract.** Extend the Provider base class (`server/src/providers/base.ts`) and
   implement both:
   - `chatCompletion()` — non-streaming request/response.
   - `streamChatCompletion()` — **SSE** streaming, yielding OpenAI-style chunks.
   Declare the endpoints/models the provider supports.

3. **Register it.** Add the adapter to `server/src/providers/index.ts` so the router can resolve it.

4. **Seed its models.** Add the provider's models in `server/src/db/index.ts` so they appear in the
   catalog and the router can pick them.

5. **Add a test.** Create `server/src/__tests__/providers/<provider>.test.ts`. Cover both
   `chatCompletion` and `streamChatCompletion` (mirror the existing provider tests, e.g.
   `google.test.ts`, `cohere.test.ts`, `openai-compat.test.ts`).

6. **Verify.** Run `npm test` and keep the suite green.

## Notes
- Rate-limit ledger keys are **`(platform, model, key)`** — see `server/src/services/ratelimit.ts`.
  A new provider participates in the ledger automatically once its models are seeded and it is
  registered.
- Never log or return upstream provider keys. Decryption stays in memory (see
  `server/src/db/index.ts`, AES-256-GCM).
