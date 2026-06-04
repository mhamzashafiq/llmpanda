---
name: tauri-packaging
description: "Use when building/packaging FreeLLMAPI as a Tauri desktop app — bundling the Node/Express server as a sidecar binary, native-module rebuilds, sidecar lifecycle, and the localhost:3001 webview."
---

# Package FreeLLMAPI as a Tauri Desktop App

Goal: ship FreeLLMAPI as a native desktop app. The production server already serves **both the
dashboard and the API on `:3001`** (`npm run build` then `node server/dist/index.js`). Tauri wraps
that: a Rust shell launches the Node server as a **sidecar** and points its webview at it.

## 1. Bundle the server as a sidecar binary
The Express server must become a single self-contained executable Tauri can spawn.
- **Recommended:** `bun build --compile` to produce a standalone binary from the built server
  entry. (Alternatives: `pkg`, Node SEA — `bun` handles the bundling cleanly.)
- Place the binary in Tauri's `externalBin` / `tauri.conf.json > bundle.externalBin`, named with the
  target triple suffix Tauri expects (e.g. `freellmapi-server-x86_64-apple-darwin`).

## 2. better-sqlite3 native-module concern
`better-sqlite3` is a **native module** — its compiled `.node` binary is platform/arch specific and
does NOT cross-compile. You must build/rebuild it for **each target platform** (macOS arm64/x64,
Windows, Linux) on (or matching) that platform, and ensure the compiled binary is included in the
sidecar bundle. Verify the bundled binary loads at runtime, not just at build time.

## 3. Point the webview at localhost:3001
The prod server serves dashboard + API on `:3001`. Set the Tauri window URL to
`http://localhost:3001` once the sidecar is up. Wait for a health/readiness signal before loading
(poll `:3001` health) to avoid a blank window on a cold start.

## 4. Sidecar lifecycle
- **Start on launch:** spawn the sidecar in the app's setup hook before showing the window.
- **Kill on close:** terminate the sidecar process on app exit (and on window-close) so no orphaned
  server lingers. Use Tauri's process API; handle the exit/`before-quit` event.
- **Port conflict:** `:3001` may be taken (another instance, or the user's own dev server). Detect
  the conflict, and either fail fast with a clear message or pick a free port and pass it to both
  the sidecar and the webview URL.

## 5. Optional polish
- **Tray icon** — minimize-to-tray, show/quit menu.
- **Autostart** — launch on login via the Tauri autostart plugin.
