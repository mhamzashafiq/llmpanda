<div align="center">
  <img src="./panda-logo.png" alt="LLM Panda" width="120" />

  # LLM Panda

  **One OpenAI- & Anthropic-compatible API in front of many free AI models.**

  Bring your own free-provider keys (or use anonymous free tiers), point any coding
  agent or OpenAI/Anthropic SDK at one endpoint, and let LLM Panda route, fall back,
  and meter across them.
</div>

---

## What it does

- **Drop-in compatible** — `POST /v1/chat/completions` (OpenAI), `POST /v1/messages`
  (Anthropic / Claude Code), `POST /v1/responses` (Codex), `/v1/embeddings`, `/v1/models`.
- **Many providers** — Google AI Studio, Groq, Cerebras, SambaNova, NVIDIA, Mistral,
  OpenRouter, GitHub Models, Cohere, Cloudflare, Zhipu, Ollama, Together, OpenCode,
  Chutes, DashScope, ModelScope, Vertex, plus keyless tiers (Kilo, Pollinations, LLM7).
- **Smart routing** — per-org fallback chain, rate-limit ledger, cooldowns, sticky
  sessions, vision-aware routing, auto-prune of dead keyless models.
- **Coding agents** — connect Claude Code, Codex, Cline, OpenCode, Goose, Continue,
  Aider, Zed, Roo. A dashboard **Agents** page generates a key + lets you pick which
  models they may use (`Best for coding` preset).
- **Token saver (RTK)** — losslessly compress bulky tool output (git diff / grep / ls /
  build logs) before it hits the model — ~20–40% fewer input tokens.
- **Terse mode** — an optional brevity system prompt for shorter (cheaper) replies.
- **Multi-tenant** — orgs, per-org client keys, envelope encryption (KEK + per-org DEK),
  per-key model allow-lists, analytics, request logs.
- **Desktop app** — `llmpanda-desktop/` runs the whole stack locally (embedded Postgres,
  no login).
- **CLI** — `cli/`: `npx llmpanda <agent>` injects the right env and launches the agent.

## Layout

| Path | What |
|---|---|
| `freellmapi/` | The hosted SaaS — Express + Postgres (Drizzle) server + React/Vite dashboard |
| `llmpanda-desktop/` | Electron desktop build (embedded Postgres, local mode) |
| `freellmapi/cli/` | `llmpanda` launcher CLI |

## Quick start

```bash
cd freellmapi
cp .env.example .env        # set ENCRYPTION_KEY + DATABASE_URL (Postgres)
npm install
npm run dev                 # server :3001 + dashboard :5173
```

See `freellmapi/DEPLOY.md` for production.

---

## ⚠️ Disclaimer — OAuth / connected-account providers

LLM Panda can connect to some services (e.g. **Kiro / AWS CodeWhisperer**,
**GitHub Copilot**) by logging into **your own account** on that service and routing
requests through it. **This may violate those services' Terms of Service and can lead to
account suspension or other consequences.** These connections are **opt-in and OFF by
default**. You are solely responsible for how you use them. The software is provided
"as is", without warranty, under the MIT License — use at your own risk.

Only use providers in a way you are authorized to. The maintainers do not endorse
violating any third party's terms.

## License

[MIT](./LICENSE) © 2026 LLM Panda
