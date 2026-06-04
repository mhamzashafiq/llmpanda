# LLM Panda — Handoff brief (paste into another Claude Code session)

You are taking over a task for **LLM Panda**, a local/offline Electron desktop app
(embedded Postgres + a forked Express server, no login). It auto-updates from the
owner's **own website `https://llmpanda.io`** using `electron-updater`'s *generic*
provider. The Windows installer is already built. **Your job: host the update feed
on llmpanda.io correctly, then verify it.** You do NOT need to rebuild the app.

> The human will give you access to wherever the website is hosted (repo / server /
> Vercel / Netlify / cPanel). Ask them for it — secrets are not in this brief.

---

## The 3 files to publish

They live on the build machine at
`C:\Users\Chaudhry\Downloads\LLMPanda\llmpanda-desktop\dist\`:

| File | ~Size | Must be reachable at | Content-Type |
|------|-------|----------------------|--------------|
| `latest.yml` | ~0.3 KB | `https://llmpanda.io/latest.yml` | `text/yaml` or `text/plain` |
| `windows.exe` | ~115 MB | `https://llmpanda.io/windows.exe` | `application/octet-stream` |
| `windows.exe.blockmap` | ~120 KB | `https://llmpanda.io/windows.exe.blockmap` | `application/octet-stream` |

`latest.yml` looks like:
```yaml
version: 1.0.0
path: windows.exe
sha512: <base64>
files:
  - url: windows.exe
    sha512: <base64>
    size: 121351732
```
The desktop app fetches `latest.yml`, compares `version` to the installed one, and
if newer downloads `windows.exe` (using `windows.exe.blockmap` for fast diffs).

---

## ⚠️ CRITICAL problem to fix first: SPA catch-all

Right now `https://llmpanda.io/latest.yml` and `/windows.exe` return **HTTP 200 but
`Content-Type: text/html` (the SPA `index.html`, ~1896 bytes)** — the site rewrites
*every* unknown path to `index.html`. If that stays, the updater gets HTML instead
of YAML and fails with `not a valid semver: "undefined"`.

**You must make these 3 exact paths serve the real static files, taking precedence
over the SPA fallback.** Detect the host and apply the matching fix:

- **Vercel** — put the files in `public/` (or root output). If `vercel.json` has a
  catch-all `rewrites`/`routes` to `/index.html`, exclude them, e.g. rewrite source
  with a negative lookahead: `"/((?!latest\\.yml|windows\\.exe|windows\\.exe\\.blockmap).*)"`,
  or add explicit `routes` for the 3 files before the catch-all. Static files in
  `public/` normally win over rewrites — verify after deploy.
- **Netlify** — put files in the publish dir. In `_redirects`/`netlify.toml` the SPA
  rule `/* /index.html 200` must NOT force-override real files (default `force=false`
  is fine; if `force=true`, add explicit lines ABOVE it:
  `/windows.exe /windows.exe 200`, same for the other two).
- **nginx** — before the SPA `try_files $uri /index.html;`, add:
  ```nginx
  location ~* \.(exe|yml|blockmap)$ { root /var/www/llmpanda; try_files $uri =404; add_header Accept-Ranges bytes; }
  ```
  (adjust `root`). Ensure Range requests are allowed (default for static files).
- **Apache / cPanel** — in `.htaccess`, before the SPA rewrite, add
  `RewriteCond %{REQUEST_FILENAME} -f` so existing files are served directly, or
  explicit `RewriteRule ^(windows\.exe|windows\.exe\.blockmap|latest\.yml)$ - [L]`.

Range requests (`Accept-Ranges: bytes`) should work — electron-updater uses them;
on diff-download failure it falls back to a full GET, so plain static hosting is OK.

---

## Verify (after publishing)

```bash
# latest.yml must be YAML, NOT html, and show the version
curl -s  https://llmpanda.io/latest.yml          # -> "version: 1.0.0", small (~300 B)
curl -sI https://llmpanda.io/latest.yml          # -> 200, Content-Type yaml/plain (NOT text/html, NOT 1896 B)
# installer must be the real binary, ~115 MB, range-capable
curl -sI https://llmpanda.io/windows.exe         # -> 200, ~121351732 bytes, application/octet-stream, Accept-Ranges: bytes
curl -sI https://llmpanda.io/windows.exe.blockmap# -> 200
```
If `latest.yml` returns `text/html` or 1896 bytes, the SPA fallback is still
shadowing it — fix that and re-test.

---

## Future releases (so the owner can repeat)

On the build machine (`...\llmpanda-desktop`, Node 22 via `nvm use 22.22.3`,
do NOT set `ELECTRON_RUN_AS_NODE`):
1. Bump `"version"` in `package.json` (e.g. `1.0.0` → `1.0.1`). Updates trigger
   only when the hosted version is GREATER than the installed one.
2. `npm run dist`
3. Re-upload the same 3 files from `dist\` (overwrite). Done — installed apps update
   themselves (animated screen → silent install → relaunch).

---

## Context: how the desktop app is set up (FYI, you don't need to change it)

- Repo: `C:\Users\Chaudhry\Downloads\LLMPanda\llmpanda-desktop` — npm workspaces
  (`shared`, `server`, `client`) + `electron/` (`main.cjs`, `preload.cjs`) + `build/`
  (icons). Build tool: `electron-builder` (config in `package.json` → `build`,
  `asar:false`, win target `nsis`).
- Runtime: Electron starts embedded Postgres in `%APPDATA%\llmpanda-desktop\pgdata`,
  forks `server/dist/index.js` (LOCAL_MODE) on `127.0.0.1:38473`, opens the dashboard.
- Update config: `package.json` → `build.publish = { provider: "generic", url:
  "https://llmpanda.io" }` and `build.nsis.artifactName = "windows.${ext}"` (so the
  installer is always named `windows.exe`).
- Don't regress these prior fixes: `server/package.json` + `build/icon.png` are in
  electron-builder `files`; the server's runtime deps are duplicated into the ROOT
  `package.json` `dependencies` ON PURPOSE (electron-builder only packages the root
  dep tree — without this the packaged app is missing `dotenv`/`express`/etc and the
  server crashes); Postgres lock auto-heal on boot; `nativeTheme = 'dark'`.
- Full details: see `DESKTOP.md` in the repo (Auto-update section).
