# LLM Panda — Desktop (local, no login, offline)

A self-contained desktop build of LLM Panda. Same UI + functionality as the web
app, but **everything runs on your machine**: an embedded Postgres auto-starts,
the backend runs in local mode, and there is **no account / no login**.

## How it works
- **Electron** runs the existing Node/Express backend in a child process and shows
  the dashboard in a native window.
- **embedded-postgres** auto-starts a real Postgres in your user-data folder
  (`pgdata/`) on first launch — no install, no setup. Schema migrations apply
  automatically; a single local workspace is provisioned on first run.
- **LOCAL_MODE** (`server`): every request is bound to the one local operator, so
  there is no login, signup, or email verification. `/api/auth/status` always
  reports authenticated.
- Provider keys are still encrypted at rest (AES-256-GCM). The encryption key is
  generated once and stored in your user-data folder (`encryption.key`).
- Free **keyless** models (llm7 / kilo / pollinations) work with zero setup; add
  your own provider keys in the dashboard for the rest.

Data locations (macOS): `~/Library/Application Support/LLM Panda/`
- `pgdata/` — the local Postgres database
- `encryption.key` — local key-encryption key (back this up to keep keys)

## Run (dev)
```bash
npm install          # one-time; downloads Electron + bundles the Postgres binary
npm run electron:dev # builds server+client, then launches the app
```

> Note: do not set `ELECTRON_RUN_AS_NODE` in your shell — it makes Electron run as
> plain Node and the window won't open.

## Package an installer
```bash
npm run dist         # builds + runs electron-builder → dmg (mac) / nsis (win) / AppImage (linux)
```

## Auto-update (self-hosted on llmpanda.io)
The app auto-updates from **our own site** via `electron-updater`'s `generic`
provider (wired in `electron/main.cjs`, active only in packaged builds). On launch
(and every 6h) it fetches `https://llmpanda.io/latest.yml`; if it lists a version
newer than the running app, it downloads `https://llmpanda.io/windows.exe` in the
background and shows a **branded animated screen** — *Downloading → Installing →
Restarting* — then silently installs and relaunches. No prompts, no installer
wizard. Before `latest.yml` exists the check just fails quietly (no UI/popup).

Config lives in `package.json` → `build.publish` (`{ provider: "generic", url:
"https://llmpanda.io" }`) and `build.nsis.artifactName` (`windows.${ext}`, so the
installer is always named `windows.exe`).

**Cut a release:**
```bash
# 1) bump "version" in package.json (e.g. 1.0.0 → 1.0.1) — updates only trigger
#    when the hosted version is GREATER than the installed one.
npm run dist
```
This produces three files in `dist/`:
- `windows.exe`            — the installer
- `windows.exe.blockmap`   — enables fast differential downloads
- `latest.yml`             — the update manifest (version + sha512 + size)

**2) Upload all three to the web root** so they're reachable at:
- `https://llmpanda.io/latest.yml`
- `https://llmpanda.io/windows.exe`
- `https://llmpanda.io/windows.exe.blockmap`

Serve them as **static files** (no redirect/SPA fallback) with the real bytes —
`latest.yml` as `text/yaml`/`text/plain`, `windows.exe` as
`application/octet-stream`. Every release overwrites the same filenames; `latest.yml`
carries the version + checksum so existing installs detect the new build.
> `npm run release` (electron-builder `--publish always`) is for providers that
> auto-upload; the `generic` provider is download-only, so upload the 3 files
> yourself (CI step / scp / dashboard).

**Caveats:**
- Windows (NSIS) auto-update works **unsigned**. SmartScreen still shows a one-time
  warning on the very first manual install; silent auto-updates after that are
  seamless. A code-signing (ideally EV) certificate removes the warning.
- **macOS auto-update would require code-signing + notarization** (Apple Developer
  cert) and a `latest-mac.yml` + `.zip`/`.dmg` on the feed — not set up here.

## Ports (loopback only)
- App server: `127.0.0.1:38473`
- Embedded Postgres: `127.0.0.1:38432`
