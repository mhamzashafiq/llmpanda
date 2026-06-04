# FreeLLMAPI — Project Progress & Architecture Memory

> Single source of truth for what's been built converting FreeLLMAPI from a
> single-operator local proxy into a multi-tenant SaaS on Supabase Postgres.
> Last updated: 2026-06-03. Keep this current as phases land.

---

## 1. What FreeLLMAPI is

OpenAI-compatible LLM proxy that aggregates ~16 **free** LLM providers behind one
unified API key. Express/TypeScript server + React (Vite + shadcn) dashboard.

- **Server:** `server/` — Express, OpenAI-compatible `/v1/chat/completions` (+ streaming)
  and `/v1` Responses-API shim (Codex CLI). Provider adapters in `server/src/providers/`.
- **Client:** `client/` — React 19 + Vite 8 + Tailwind v4 + shadcn, **apex-ui** design system.
- **Design system:** apex-ui — acid-green `#d6fb03`, dark `#191919`, card `#272727`,
  uppercase Unbounded headings, Roboto body, pill CTAs. Status-color exception:
  healthy=accent, rate_limited `#f5a623`, invalid `#ff4d4f`.

---

## 2. Locked architecture decisions (user)

- **Supabase Postgres only.** SQLite + local-first/Tauri mode **dropped**.
- **No RLS.** Tenant isolation = **app-layer `org_id` scoping only**. Isolation guard +
  tests are the sole backstop (release-blocker if they fail).
- **Custom auth on Postgres** (email+password+sessions; orgs added; OAuth/verify/reset later).
- **Drizzle ORM (pg-core) + postgres.js** data layer; `drizzle-kit` migrations.
- **Rate ledger in Postgres table** (no Redis). In-memory windows Map removed for statelessness.
- **Workers via pg-boss** (Postgres-backed queue) — health checks + usage rollups (Phase 4).
- **BYOK-first.** Orgs bring their own free-provider keys. Never pool free tiers (ToS).
- Billing: usage + seats (Stripe, Phase 5).
- Client never talks to Supabase directly — only to our Express API.

---

## 3. Phased roadmap & status

| Phase | Focus | Status |
|---|---|---|
| **1** | DB lift: SQLite→Postgres/Supabase, sync→async, Drizzle schema + migrations + seed | ✅ DONE (live streaming verified) |
| **2** | Auth & tenancy: orgs/memberships/roles, signup/login, ctx middleware, `org_id` scope ALL queries, isolation guard | ✅ DONE — full org-scoping sweep + per-org unified key; isolation verified across 3 orgs (keys/analytics/logs/proxy) + security-reviewed |
| **3** | Client API keys: `api_clients` multi-key per org; `/v1` resolves tenant | ✅ DONE — hashed/revocable client keys, `/v1` resolves via hash, backfill from unified_key, UI on /connect; verified |
| **4** | pg-boss workers (health + housekeeping out of request path); per-org plan quotas | ✅ DONE — pg-boss queue (health 5m, housekeeping 30m, in-proc fallback); per-org plan + monthly quota gate at proxy |
| **5** | Billing: Stripe plans/entitlements, quota gating, webhooks, portal | 🟡 SCAFFOLD — plan/quota LIVE; Stripe checkout/portal/webhook env-gated stubs (NEEDS your Stripe keys) |
| **6** | SaaS frontend: org switcher, Team / Billing / Usage pages, multi-key UI, onboarding | 🟡 PARTIAL — multi client-key UI done; Team/Billing/Usage pages + org switcher pending |
| **7** | Security hardening: cross-tenant isolation test, audit-log, GDPR | ✅ DONE — `audit_log` + `audit()` (key/client/GDPR events), GDPR export + erasure (owner+confirm), standalone isolation verifier (green) |
| **8** | Observability/deploy: structured logs+request IDs, Sentry, deploy | 🟡 PARTIAL — request-id + JSON access logs + Sentry (PII-scrubbed) done; containerize/CI/deploy NEED hosting |
| **9** | Launch: private beta, load test, docs, pricing | ⬜ pending (external) |

Plan file: `/Users/chaudhry/.claude/plans/dapper-tickling-tulip.md`.

---

## 4. Phase 1 — DONE (DB lift, no behaviour change)

Migrated raw **synchronous better-sqlite3** (203 `.prepare()` sites, no Drizzle despite the dep)
→ **postgres.js tagged-SQL + Drizzle (async)**. `await` rippled through every service/route.

**New / rewritten files:**
- `server/src/db/client.ts` — `export const sql = postgres(connectionString, { max: 10 })`;
  `export const db = drizzle(sql, { schema })`. `DEFAULT_LOCAL =
  postgresql://postgres:postgres@127.0.0.1:55322/postgres`.
- `server/src/db/schema.ts` — Drizzle pg schema. Tables: `models`, `api_keys`, `requests`,
  `rate_limit_usage`, `rate_limit_cooldowns`, `fallback_config`, `settings`, `users` (+`full_name`),
  `sessions`, `organizations`, `memberships`, `leads`. `org_id` (nullable int) on api_keys,
  requests, rate_limit_usage, rate_limit_cooldowns, fallback_config.
- `server/src/db/index.ts` — removed better-sqlite3 / createTables / migrateModelsV1..V18.
  `initDb()` async: initEncryptionKey → seedCatalog (from seed-catalog.ts if models empty) →
  ensureUnifiedKey. Async getUnifiedApiKey / regenerateUnifiedKey / getSetting / setSetting.
- `server/src/db/seed-catalog.ts` — auto-generated `SEED_MODELS` (109) + `SEED_FALLBACK` dumped from sqlite.
- `server/src/db/migrations/0000_great_princess_powerful.sql`, `0001_last_expediter.sql` — applied to Supabase.
- `server/drizzle.config.ts` — dialect postgresql, schema/out paths, `DATABASE_URL`.
- `server/src/lib/crypto.ts` — `initEncryptionKey()` async no-arg, uses sql. AES-256-GCM, in-memory decrypt only.
- `server/src/services/auth.ts` — `SessionUser{userId,email,orgId}`, `CreateUserOpts{fullName,orgName}`;
  createUser uses `sql.begin()` txn → user + org + owner membership; verify/validate join membership for orgId.
- `server/src/services/ratelimit.ts` — async PG-only; dropped in-memory windows Map; kept in-memory
  cooldownHits escalation heuristic.
- `server/src/services/router.ts` — async routeRequest / getRoutingScores / refreshStatsCache /
  get|setRoutingStrategy / hasEnabledVisionModel.
- `server/src/services/health.ts`, `routes/{auth,keys,fallback,analytics,health,settings,models,proxy,responses}.ts`,
  `middleware/requireAuth.ts`, `app.ts`, `index.ts` — all async-converted.
- `server/tsconfig.json` — exclude `"src/scripts"`.

**PG dialect fixes applied:**
- `datetime('now')` → `now()`; `strftime` → `to_char`;
  `date('now','start of month')` → `date_trunc('month', now())`;
  `julianday` age → `FLOOR(EXTRACT(EPOCH FROM (now()-created_at))/86400)`.
- `::int` / `::float` casts; Date params must be ISO strings (postgres.js rejected raw Date) → `.toISOString()`.
- PG strict GROUP BY (error-distribution: removed `model_id` from SELECT).
- `sql.unsafe()` only for whitelisted ORDER BY; `RETURNING id`; `ON CONFLICT DO NOTHING/UPDATE`; `result.count`.

**Supabase local (Docker):** CLI 2.98.2, ports remapped to **553xx** (db 55322, studio 55323) to
coexist with a separate "team" stack on 5432x. config.toml edited.

**Data migration:** old sqlite-encrypted keys couldn't decrypt under new PG encryption key →
data-migrator copies sqlite `encryption_key` into PG settings + api_keys blobs, then restart. **Verified streaming works.**

**Verification done:** login, add provider key, Playground stream, Analytics, Logs, Fallback gauges — all work on Postgres.

---

## 5. Phase 2 — DONE (auth & tenancy + full isolation)

**Tenancy backbone:**
- Tables `organizations` (+`unified_key`), `memberships`, `leads`; `org_id` on every tenant table —
  **NOT NULL** on api_keys/requests/rate_limit_usage/rate_limit_cooldowns; nullable on fallback_config
  (rows with `org_id IS NULL` are the shared seed TEMPLATE).
- `createUser` txn → user + org + owner membership + mints `unified_key` + **clones fallback template** into the org.
- **Open registration** (`POST /api/auth/register`, 409 `email_taken`) + lead-gen capture. Setup screen removed.
- **Route-based auth** (client): `AuthScreen`, `RequireAuth` guard, `useAuthStatus()`.

**Isolation sweep (the real work) — `org_id` scoping, NO RLS:**
- **`requireOrg(req,res)`** (`server/src/lib/tenant.ts`) — single chokepoint; every `/api/*` handler calls it first.
  `req.user` typed via `server/src/types/express.d.ts`.
- **Per-org unified key**: proxy + responses shim resolve tenant via `resolveOrgByUnifiedKey(token)`
  (`db/index.ts`); `/connect` shows/regenerates the session org's key. Old global settings key retired.
- Every dashboard query scoped: keys, analytics (8 queries), fallback, settings, models, health.
- IDOR-safe: DELETE/PATCH `/keys/:id`, `/keys/platform/:p`, `/health/check/:keyId`, fallback PUT/sort all
  constrain `AND org_id`.
- `router.ts`: `routeRequest(orgId,…)` / `getRoutingScores(orgId)` / `hasEnabledVisionModel(orgId)` filter
  api_keys + fallback_config by org; **per-org `statsCache`**; routing strategy per-org (`routing_strategy:<orgId>`).
- `ratelimit.ts`: org stamped on writes; reads also filter `org_id` (defense-in-depth, not just key_id-implies-org).
- `health.ts`: dashboard checks org-scoped; background sweep stays system-wide.
- Migration `0002_tenancy_scoping.sql`: backfill (legacy keys→operator org), fallback unique→`(org_id,model_db_id)`,
  NOT NULL. `ensureOrgUnifiedKeys()` backfills on boot.

**Verified (3 orgs, agent-browser + curl):** fresh org sees 0 keys/0 analytics/empty logs; org A's key invisible to
org B; `/v1` with org A's unified key uses ONLY org A's provider keys (org B's key → exhausted/provider-error, never
borrows A's); request log + ledger correctly org-stamped.

**Security-reviewed** (security-reviewer agent): no cross-tenant leak found. Fixed: Sentry `sendDefaultPii:false` +
beforeSend scrubs auth headers / secret-shaped frame locals (was a key-exfil vector); ledger reads now org-filtered.
Open follow-ups (non-blocking): cooldown unique index could add org_id (currently key_id is globally unique so safe);
dead `timingSafeStringEqual` in proxy.ts; `seedCatalog` fallback-template seed guarded by models-count (M3).

---

## 6. Phase 8 — Sentry (PARTIAL)

**Server (active, verified):**
- `@sentry/node`. `server/src/instrument.ts` — `Sentry.init({ dsn, environment, sendDefaultPii:true })`;
  DSN from `process.env.SENTRY_DSN` else literal fallback
  `https://8eb75842c1ace780938bfdc28d386635@o4511498078191616.ingest.us.sentry.io/4511498081861632`.
  Captures uncaughtException / unhandledRejection.
- `server/src/index.ts`: `import './env.js'; import './instrument.js';` BEFORE app.
- `server/src/app.ts`: `Sentry.setupExpressErrorHandler(app)` after controllers, before `errorHandler`.
- Boot log `[sentry] error monitoring enabled`; test event sent successfully.

**Client (env-gated, built clean, NOT yet active):**
- `@sentry/react`. `client/src/main.tsx`: init only when `import.meta.env.VITE_SENTRY_DSN` set;
  wraps `<App/>` in `Sentry.ErrorBoundary` (apex fallback).
- **To activate:** create a Sentry **React** project → put its DSN in `client/.env` as `VITE_SENTRY_DSN` → restart dev.

ntfy noted as alert-only alternative (needs dedup). Sentry free Developer plan = $0 after trial.

---

## 7. Key infra facts (gotchas to remember)

- Vite proxies `/api` and `/v1` → `:3001`. `/api-key` route collided with `/api` proxy on hard-load →
  **renamed route to `/connect`** (label stays "API Key"). VERIFIED.
- `client/src/pages/ApiKeyPage.tsx` uses literal `:3001` (not `__SERVER_PORT__`).
- Dashboard nav (sidebar, off-canvas drawer on mobile): Playground, API Key→`/connect`, Keys, Fallback, Analytics, Logs.
- Providers added to dropdown: **Together AI**, **OpenCode Zen** (beyond original set).
- agent-browser: synthetic `click`/`fill` desync with React controlled inputs → use eval `.click()` + `type`.
- apex form fields/dropdowns: `client/src/components/ui/{input,select}.tsx` (rounded-xl, bg #272727, accent focus).

---

## 7b. Envelope encryption (provider-key security) — DONE

Keys are protected by **two-tier (envelope) AES-256-GCM**, not a single DB-resident key:
- **KEK** (master Key-Encryption-Key) from `ENCRYPTION_KEY` **env** (gitignored `.env`; secrets
  manager in prod). **Never in the DB** — production refuses a DB KEK.
- **Per-org DEK** (random 32B) encrypts that org's provider keys; stored **wrapped by the KEK** on
  `organizations.dek_wrapped/dek_iv/dek_tag`. One org's DEK can't decrypt another's data.
- `server/src/lib/crypto.ts`: `encryptForOrg/decryptForOrg` (DEK), `createOrgDek` (race-safe wrap),
  `decryptWithKek` (legacy). 12-byte GCM nonce for new writes; old 16-byte IV rows still decrypt.
- Boot (`db/index.ts`): `ensureOrgDeks()` provisions a DEK per org; `migrateLegacyProviderKeys()`
  re-encrypts any KEK-direct key → DEK (idempotent).
- Call sites async-scoped: keys.ts, account.ts (export), router.ts (`decryptForOrg(orgId,…)`),
  health.ts (`decryptForOrg(row.org_id,…)`). Dashboard/export return **masked** only; decrypt is
  in-memory at point-of-use.

**Verified:** boot logged `provisioned DEKs for 8 org(s)` + `re-encrypted 8 provider key(s) KEK->DEK`;
migrated + new keys decrypt via DEK; `/v1` works. DB master key **deleted** (`settings.encryption_key`
gone), dead `unified_api_key` setting removed → **zero secret material in DB** (only ciphertext +
wrapped DEKs). **Leak sim:** full DB dump without the env KEK → DEK unwrap fails 3/3 (256-bit KEK);
with env KEK → decrypts. **To rotate the KEK**: re-wrap every org DEK under the new KEK (DEKs +
ciphertext unchanged).

## 7c. Public-launch hardening — DONE (code side)

For a public free launch (Team/Billing UI + Stripe deferred):
- **Auth rate limiting:** `createIpRateLimiter` in `middleware/rateLimit.ts`; `/api/auth` gated by
  `createAuthRateLimiter` (`AUTH_RATE_LIMIT_RPM`, default 30/min/IP) + `app.set('trust proxy', …)`.
  Login keeps its per-email lockout as a second layer. Verified: flood → 429.
- **Security headers:** production-only helmet CSP (SPA-safe: self + inline styles + data: + Sentry
  ingest) + HSTS in `app.ts` (`NODE_ENV=production`); dev unchanged. **CORS** drops localhost in prod
  and requires `DASHBOARD_ORIGINS`. Verified: prod `curl -I` shows CSP+HSTS; evil Origin rejected.
- **Email verification (required to log in) + password reset over SMTP:**
  - `services/email.ts` — nodemailer transport if SMTP env set, else console-logs the link (dev).
  - `users.email_verified` (migration 0007; **all pre-existing users grandfathered = 1**) + single-use
    hashed `email_tokens` (verify 24h / reset 1h).
  - `services/auth.ts`: `createEmailToken`/`consumeEmailToken`/`markEmailVerified`/`setPassword`;
    `verifyCredentials` → `CredResult` (`invalid` vs `unverified`).
  - `routes/auth.ts`: register sends verify link + **no auto-login** (`{needsVerification}`); login
    403 `email_unverified`; `POST /verify`, `/resend-verification`, `/forgot-password`,
    `/reset-password` (no enumeration; reset invalidates sessions).
  - Frontend `auth-gate.tsx` + `App.tsx`: register "check your email" state, `/verify`,
    `/reset-password`, `/forgot` routes, "Forgot password?" + resend-verification.
  - Verified: register→403-unverified→verify→login; grandfathered users log in; reset (single-use,
    old pw 401, new works); isolation regression `ISOLATION OK`.
- **Ops:** `.env.example` (all envs incl. KEK warning), `scripts/rotate-kek.ts` (re-wrap org DEKs
  old→new), `DEPLOY.md` (Supabase Cloud, migrations 0000–0007, secrets+KEK backup, HTTPS, smoke test).

**Still needs the user before public launch:** hosting + Supabase Cloud + domain/HTTPS, SMTP creds,
KEK in a secrets manager + backups. Paid launch additionally needs Stripe + Phase 6 UI.

## 8. Provider contract (must hold for every adapter)

`server/src/providers/**` — each adapter MUST: implement `chatCompletion()` + `streamChatCompletion()`
(base `base.ts`); declare endpoints/models; register in `index.ts`; seed models in `db/index.ts`
(now seed-catalog.ts); ship a test in `__tests__/providers/`; **never log/return upstream keys**.
See `.claude/skills/add-provider`.

---

## 9. Outstanding work (next sessions)

- **Phase 2 sweep** (highest priority per user "phly sary phases pury kro"): org_id ctx middleware +
  scope every query + isolation guard + roles. Make org_id NOT NULL after backfill.
- **Phase 3:** `api_clients` multi-key per org; `/v1` resolves tenant from client key; retire singleton unified key.
- **Phase 4:** drop any residual in-memory ledger state; per-org plan quotas; pg-boss workers.
- **Phase 5:** Stripe (needs user account/keys).
- **Phase 6:** SaaS frontend (Team/Billing/Usage, org switcher, onboarding).
- **Phase 7:** isolation test suite + audit log + GDPR.
- **Phase 8 finish:** client Sentry DSN, structured logs+request IDs, containerize, CI/CD, deploy, status page.
- **P1 cleanup:** port ~21 test files (`server/src/__tests__/`) to PG; remove better-sqlite3 dep.
