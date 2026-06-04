// Minimal preload — no privileged bridge needed; the renderer talks to the
// local server over HTTP exactly like the web build. Kept for contextIsolation.
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('llmpanda', { desktop: true })
