# LLM Panda — Deploy / launch checklist

Public free-launch deployment. The app is a single Node process that serves both
the API (`/api`, `/v1`) and the built dashboard on one port.

## 1. Database (Supabase Cloud / managed Postgres)
- Create a Postgres DB; copy its connection string → `DATABASE_URL`.
- Apply migrations in order (psql or your migration tool):
  `server/src/db/migrations/0000…0007*.sql`.
- The app also self-seeds on first boot (model catalog, per-org DEKs, default clients).

## 2. Secrets (use a secrets manager, not a plaintext file)
- `ENCRYPTION_KEY` — 64-hex master KEK. **Generate once, back it up.**
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  Losing it = every stored provider key is unrecoverable.
- `DATABASE_URL`, SMTP creds, `SENTRY_DSN` (optional).

## 3. Environment (see `.env.example`)
- `NODE_ENV=production` (enables CSP + HSTS + trust-proxy + CORS lockdown).
- `APP_URL=https://app.yourdomain.com` (verification / reset email links).
- `DASHBOARD_ORIGINS=https://app.yourdomain.com` (required in prod — localhost
  defaults are dropped).
- `PROXY_RATE_LIMIT_RPM` / `AUTH_RATE_LIMIT_RPM` (defaults 120 / 30 per IP/min).
- SMTP: `SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`. **Email verification is required
  to log in** — without SMTP, links only print to the server log.
- Build the client with `VITE_SENTRY_DSN` set if you want browser error reporting.

## 4. Build + run
```
npm install
npm run build                 # builds server (tsc) + client (vite)
node server/dist/index.js     # serves API + dashboard on PORT (default 3001)
```
Put it behind a reverse proxy / platform that terminates **HTTPS/TLS** (Fly,
Railway, Render, Caddy/nginx…). `trust proxy` is on in prod so client IPs are
correct for rate limiting.

## 5. Smoke test (prod)
1. `curl -I https://app.yourdomain.com` → `Content-Security-Policy` + `Strict-Transport-Security` present.
2. Register → "check your email"; the verify link arrives (or is logged); `/login`
   before verifying → 403 `email_unverified`.
3. Verify → login → add a provider key → Playground stream → `/v1/chat/completions` works.
4. Forgot password → reset link → new password logs in (old sessions invalidated).
5. `node server/dist/scripts/...` not needed; run `npx tsx server/src/scripts/verify-isolation.ts`
   against the running server → `ISOLATION OK`.

## 6. Backups (critical)
- **Back up the `ENCRYPTION_KEY`** separately from the DB (e.g. secrets manager +
  an offline copy). DB backup alone cannot decrypt provider keys without it.
- Enable managed Postgres automated backups + PITR.

## 7. Key rotation (when needed)
```
OLD_ENCRYPTION_KEY=<old> ENCRYPTION_KEY=<new> DATABASE_URL=<url> \
  npx tsx server/src/scripts/rotate-kek.ts
# then set ENCRYPTION_KEY=<new> in the environment and restart
```

## Deferred (not blocking a free launch)
Team/Billing/Usage UI + org switcher, Stripe wiring, green test-suite port, CI/CD,
load testing.
