# FreeLLMAPI

## Project overview
FreeLLMAPI is a TypeScript, OpenAI-compatible proxy that aggregates 14 free AI providers behind a
single API + dashboard. It is **single-user / local-first**: one operator runs it on their own
machine, stores their own provider keys, and talks to it over localhost.

Two active goals:
1. **Tauri desktop app** — package the server as a sidecar binary serving `:3001`, wrapped in a
   native window. See `.claude/skills/tauri-packaging`.
2. **apex-ui dashboard redesign** — rebuild the React dashboard on the apex-ui design system. See
   `.claude/skills/apex-ui`.

## Architecture map
Paths relative to repo root (`freellmapi/`).

- `server/src/services/router.ts` — per-request model pick (which provider/key serves a model).
- `server/src/services/ratelimit.ts` — RPM/RPD/TPM/TPD ledger + cooldowns. **Ledger keys are
  `(platform, model, key)`.**
- `server/src/providers/*.ts` — one adapter per provider. Each implements `chatCompletion()` and
  `streamChatCompletion()` against the Provider base class (`providers/base.ts`). `openai-compat.ts`
  is the template; registry is `providers/index.ts`.
- `server/src/services/health.ts` — provider/key health tracking.
- `server/src/db/index.ts` — SQLite (better-sqlite3 + Drizzle). Provider keys are encrypted with
  **AES-256-GCM**; decryption happens in memory only.
- `client/` — React 19 + Vite + Tailwind v4 + shadcn (`@base-ui/react`) dashboard.

## Dev commands
Run from `freellmapi/`.

- `npm run dev` — server on **:3001** + dashboard on **:5173** (concurrently).
- `npm test` — vitest (server suite; client `--if-present`).
- `npm run build` then `node server/dist/index.js` — production: the built server serves the
  dashboard + API on `:3001`.

## Conventions
- TypeScript throughout. Respect `.editorconfig` and `tsconfig`.
- Every change/PR ships a test. Keep the vitest suite **green** (`npm test`).

## Design
The dashboard UI follows the **apex-ui** skill: acid-green accent `#d6fb03`, uppercase Unbounded
headings, pill CTAs, dark cards (`#272727`). apex-ui's single-chromatic-color rule has **one
allowed exception** — functional STATUS colors:

| status | color |
|---|---|
| healthy | accent `#d6fb03` |
| rate_limited | amber `#f5a623` |
| invalid | red `#ff4d4f` |
| error / disabled | muted |

These STATUS colors are the ONLY permitted second chromatic colors. Everything else stays apex-ui.

## Pointers
- For UI work see `.claude/skills/apex-ui`.
- To add a provider see `.claude/skills/add-provider`.
- For desktop packaging see `.claude/skills/tauri-packaging`.
