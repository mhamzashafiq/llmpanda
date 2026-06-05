const { app, BrowserWindow, Menu, shell, dialog, nativeTheme } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const { fork, execFileSync } = require('child_process')
const { pathToFileURL } = require('url')

// LLM Panda — desktop. Boots an embedded Postgres, runs the Express backend in
// LOCAL_MODE (no login), then opens the dashboard. Everything stays on-machine.

const isDev = !app.isPackaged
const PORT = 38473        // app server
const PG_PORT = 38432     // embedded postgres
const APP_URL = `http://127.0.0.1:${PORT}`
let pg = null
let server = null
let win = null
let updateWin = null
let updateWinReady = false
let upState = { phase: 'Preparing update…', pct: -1 }

// Single-instance lock: a 2nd launch would try to bind the same Postgres port
// and crash. Instead, focus the existing window and exit the 2nd process.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  main()
}

function userFile(...p) { return path.join(app.getPath('userData'), ...p) }
function appPath(...p) { return isDev ? path.join(__dirname, '..', ...p) : path.join(process.resourcesPath, 'app', ...p) }

// App icon (dock / window / taskbar). Packaged builds use the bundle/exe icon
// set by electron-builder; this covers dev + Linux window + Windows taskbar.
const ICON_PNG = path.join(__dirname, '..', 'build', 'icon.png')
const ICON = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')

function loadEncryptionKey() {
  const f = userFile('encryption.key')
  try { const k = fs.readFileSync(f, 'utf8').trim(); if (k) return k } catch { /* first run */ }
  const k = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, k, { mode: 0o600 })
  return k
}

// Remember window size + position across launches.
function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(userFile('window-state.json'), 'utf8')) } catch { return {} }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return
  try {
    const b = win.getBounds()
    fs.writeFileSync(userFile('window-state.json'), JSON.stringify({ ...b, maximized: win.isMaximized() }))
  } catch { /* noop */ }
}

// --- Postgres lock recovery -------------------------------------------------
// embedded-postgres' stop() can throw on Windows (a known "done is not a
// function" bug), leaving an orphaned postmaster that holds the port plus a
// stale pgdata/postmaster.pid — which blocks the NEXT launch (the app would
// hang on the splash, e.g. right after an auto-update restart). These helpers
// clear ONLY the lock file + that orphaned process. The database files are
// never touched (Postgres recovers via WAL on the next start), so NO user data
// is lost.
function readPostmasterPid(dataDir) {
  try {
    const pid = parseInt(fs.readFileSync(path.join(dataDir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0], 10)
    return Number.isInteger(pid) ? pid : null
  } catch { return null }
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return !!e && e.code === 'EPERM' }
}
// Confirm a live PID really is a postgres process before killing it, so a PID
// reused by an unrelated app (e.g. after a reboot) is never taken down.
function isPostgresProcess(pid) {
  try {
    if (process.platform === 'win32') {
      return /postgres\.exe/i.test(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' }))
    }
    return /postgres/i.test(execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }))
  } catch { return false }
}
async function healPostgresLock(dataDir) {
  const pidFile = path.join(dataDir, 'postmaster.pid')
  if (!fs.existsSync(pidFile)) return
  const pid = readPostmasterPid(dataDir)
  if (pid && pidAlive(pid) && isPostgresProcess(pid)) {
    try { process.kill(pid) } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 1000)) // let the OS release the port + lock
  }
  try { fs.rmSync(pidFile, { force: true }) } catch { /* noop */ }
}

async function startPostgres() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const dataDir = userFile('pgdata')
  const fresh = !fs.existsSync(path.join(dataDir, 'PG_VERSION'))
  if (!fresh) await healPostgresLock(dataDir) // recover from an unclean prior shutdown (data-safe)
  pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'panda', password: 'panda', port: PG_PORT, persistent: true })
  if (fresh) await pg.initialise()
  await pg.start()
  try { await pg.createDatabase('llmpanda') } catch { /* already exists */ }
  return `postgresql://panda:panda@127.0.0.1:${PG_PORT}/llmpanda`
}

function startServer(databaseUrl) {
  server = fork(appPath('server', 'dist', 'index.js'), [], {
    cwd: appPath('server'),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', LOCAL_MODE: '1',
      PORT: String(PORT), DATABASE_URL: databaseUrl, ENCRYPTION_KEY: loadEncryptionKey(),
      APP_URL, DASHBOARD_ORIGINS: APP_URL, CLIENT_DIST: appPath('client', 'dist'),
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  server.on('exit', (code) => { if (code) console.error('[server] exited', code) })
}

function waitForServer() {
  return new Promise((resolve) => {
    const tick = () => {
      http.get(`${APP_URL}/api/ping`, (r) => { r.statusCode === 200 ? resolve() : setTimeout(tick, 300) })
        .on('error', () => setTimeout(tick, 300))
    }
    tick()
  })
}

// Branded "starting…" splash shown instantly while Postgres + the server boot.
// Written to userData (writable) so it can reference the bundled panda icon via
// a file:// URL — a data: page can't load a local image, hence the temp file.
function splashFile() {
  const logo = appPath('build', 'panda-logo.png')
  const logoTag = fs.existsSync(logo)
    ? `<img class="m" src="${pathToFileURL(logo).href}" alt="LLM Panda">`
    : `<div class="m mp">P</div>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0d0d0d;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif}
  .m{width:96px;height:96px;border-radius:999px;background:#5fb13a;object-fit:contain;padding:13px;box-sizing:border-box}
  .mp{background:#5fb13a;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:44px;color:#191919}
  .t{font-weight:700;letter-spacing:2px;text-transform:uppercase;font-size:14px}.s{font-size:12px;color:#8a8a8a}
  .sp{width:26px;height:26px;border:3px solid #2a2a2a;border-top-color:#5fb13a;border-radius:999px;animation:r .8s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
</style></head><body>${logoTag}<div class="t">LLM Panda</div><div class="sp"></div><div class="s">Starting your local engine…</div></body></html>`
  const out = userFile('splash.html')
  try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html) } catch { /* noop */ }
  return out
}

// Branded, animated "smart screen" shown while an update downloads + installs.
// A frameless modal over the dashboard, driven from main via executeJavaScript
// (window.__update(phase, pct)) — no preload IPC needed.
function updateWindowFile() {
  const logo = appPath('build', 'panda-logo.png')
  const logoTag = fs.existsSync(logo)
    ? `<img class="m" src="${pathToFileURL(logo).href}" alt="LLM Panda">`
    : `<div class="m mp">P</div>`
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0d0d0d;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;-webkit-user-select:none;user-select:none}
  .m{width:84px;height:84px;border-radius:999px;background:#5fb13a;object-fit:contain;padding:11px;box-sizing:border-box;animation:bob 2.4s ease-in-out infinite}
  .mp{background:#5fb13a;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:40px;color:#191919}
  @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
  .t{font-weight:700;letter-spacing:2px;text-transform:uppercase;font-size:13px}
  .s{font-size:12px;color:#9a9a9a;min-height:16px;text-align:center}
  .track{width:300px;height:8px;border-radius:999px;background:#1c1c1c;overflow:hidden;position:relative}
  .fill{height:100%;width:0%;border-radius:999px;background:#5fb13a;position:relative;transition:width .25s ease}
  .fill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent);transform:translateX(-100%);animation:shine 1.4s linear infinite}
  .fill.indet{animation:indet 1.15s ease-in-out infinite}
  @keyframes shine{100%{transform:translateX(100%)}}
  @keyframes indet{0%{margin-left:-45%;width:45%}50%{width:55%}100%{margin-left:100%;width:45%}}
  .pct{font-size:11px;color:#5fb13a;font-variant-numeric:tabular-nums;min-height:14px;letter-spacing:1px}
</style></head><body>
  ${logoTag}
  <div class="t">LLM Panda</div>
  <div class="s" id="phase">Preparing update…</div>
  <div class="track"><div class="fill" id="bar"></div></div>
  <div class="pct" id="pct"></div>
  <script>
    window.__update = function(phase, pct){
      var ph=document.getElementById('phase'), bar=document.getElementById('bar'), pc=document.getElementById('pct');
      if(ph) ph.textContent = phase;
      if(pct < 0){ bar.classList.add('indet'); bar.style.width=''; pc.textContent=''; }
      else { bar.classList.remove('indet'); bar.style.width = pct + '%'; pc.textContent = pct + '%'; }
    };
  </script>
</body></html>`
  const out = userFile('update.html')
  try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, html) } catch { /* noop */ }
  return out
}

function pushUpdateUI() {
  if (!updateWin || updateWin.isDestroyed() || !updateWinReady) return
  updateWin.webContents
    .executeJavaScript(`window.__update && window.__update(${JSON.stringify(upState.phase)}, ${upState.pct})`)
    .catch(() => { /* window may have closed mid-call */ })
}

function setUpdateUI(phase, pct) {
  upState = { phase, pct: (typeof pct === 'number' ? pct : -1) }
  pushUpdateUI()
}

function showUpdateWindow() {
  if (updateWin && !updateWin.isDestroyed()) { updateWin.focus(); return }
  updateWinReady = false
  updateWin = new BrowserWindow({
    width: 460, height: 300, parent: win && !win.isDestroyed() ? win : undefined,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    frame: false, backgroundColor: '#0d0d0d', title: 'Updating LLM Panda',
    alwaysOnTop: true, center: true, show: false,
    ...(fs.existsSync(ICON) ? { icon: ICON } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, devTools: false },
  })
  try { updateWin.removeMenu() } catch { /* noop */ }
  updateWin.once('ready-to-show', () => { if (updateWin && !updateWin.isDestroyed()) updateWin.show() })
  updateWin.webContents.once('did-finish-load', () => { updateWinReady = true; pushUpdateUI() })
  updateWin.on('closed', () => { updateWin = null; updateWinReady = false })
  updateWin.loadFile(updateWindowFile())
}

function createWindow() {
  const st = loadWindowState()
  win = new BrowserWindow({
    width: st.width || 1320, height: st.height || 880,
    x: st.x, y: st.y, minWidth: 980, minHeight: 640,
    backgroundColor: '#0d0d0d', title: 'LLM Panda', show: false,
    ...(fs.existsSync(ICON) ? { icon: ICON } : {}),
    webPreferences: { contextIsolation: true, nodeIntegration: false, devTools: false, preload: path.join(__dirname, 'preload.cjs') },
  })
  if (st.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  win.loadFile(splashFile())           // instant splash
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
  win.on('close', saveWindowState)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Data Folder', click: () => shell.openPath(app.getPath('userData')) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'LLM Panda Website', click: () => shell.openExternal('https://llmpanda.io') },
        { label: 'About', click: () => dialog.showMessageBox(win, { type: 'info', title: 'LLM Panda', message: 'LLM Panda — Desktop', detail: `Local OpenAI-compatible LLM router.\nVersion ${app.getVersion()}\nEverything runs on your machine.` }) },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// Auto-update from our own site (electron-updater "generic" provider — see the
// publish.url in package.json, baked into app-update.yml at build time). Only
// runs in a packaged build. When a newer version is found on the feed we show a
// branded animated screen: Downloading → Installing → Restart, fully automatic.
// Windows applies updates unsigned; before the feed exists the check just errors
// quietly (no UI, no popup). macOS would additionally need signing + notarizing.
function setupAutoUpdate() {
  if (isDev) return
  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', () => {
      setUpdateUI('Downloading update…', 0)
      showUpdateWindow()
    })
    autoUpdater.on('download-progress', (p) => {
      const pct = Math.max(0, Math.min(100, Math.round(p && p.percent ? p.percent : 0)))
      setUpdateUI('Downloading update…', pct)
    })
    autoUpdater.on('update-downloaded', () => {
      setUpdateUI('Installing update…', -1)
      // Brief beats so the user sees the animation, then silent install + relaunch.
      setTimeout(() => {
        setUpdateUI('Restarting LLM Panda…', -1)
        setTimeout(() => { pendingInstall = true; app.quit() }, 900)
      }, 1200)
    })
    autoUpdater.on('error', (e) => {
      console.error('[updater]', e && e.message)
      // Only surface failures if the user was already watching the update screen.
      if (updateWin && !updateWin.isDestroyed()) {
        setUpdateUI('Update failed — will retry later', 0)
        setTimeout(() => { if (updateWin && !updateWin.isDestroyed()) updateWin.close() }, 2600)
      }
    })

    autoUpdater.checkForUpdates().catch(() => { /* feed not reachable yet */ })
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000) // re-check every 6h
  } catch (e) { console.error('[updater] setup failed:', e && e.message) }
}

async function cleanup() {
  try { server && server.kill() } catch { /* noop */ }
  try { if (pg) await pg.stop() } catch { /* embedded-postgres stop() can throw on Windows */ }
  // Fallback: if stop() failed and left a live postmaster, kill it now so the
  // next launch (e.g. after an auto-update restart) isn't blocked by the lock.
  try { await healPostgresLock(userFile('pgdata')) } catch { /* noop */ }
}

let quitting = false
let pendingInstall = false
// Single graceful-quit path: stop the server + Postgres first, THEN either run
// the downloaded installer (auto-update restart) or exit.
async function gracefulQuit() {
  if (quitting) return
  quitting = true
  await cleanup()
  // Silent install (our animated screen is the UI) + auto-relaunch after update.
  if (pendingInstall) autoUpdater.quitAndInstall(true, true)
  else app.exit(0)
}

function main() {
  app.whenReady().then(async () => {
    // Force dark UI so the native title bar + menu match the app's dark theme.
    nativeTheme.themeSource = 'dark'
    // macOS dock icon (packaged app uses the bundle icon; this is for dev).
    if (process.platform === 'darwin' && app.dock && fs.existsSync(ICON_PNG)) {
      try { app.dock.setIcon(ICON_PNG) } catch { /* noop */ }
    }
    buildMenu()
    createWindow()                     // splash up immediately
    try {
      const dbUrl = await startPostgres()
      startServer(dbUrl)
      await waitForServer()
      if (win && !win.isDestroyed()) win.loadURL(`${APP_URL}/playground`)
      setupAutoUpdate()
    } catch (e) {
      console.error('[boot] failed:', e)
      dialog.showErrorBox('LLM Panda failed to start', String(e && e.message ? e.message : e))
      await cleanup(); app.exit(1)
    }
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') gracefulQuit() })
  app.on('before-quit', (e) => { if (!quitting) { e.preventDefault(); gracefulQuit() } })
}
