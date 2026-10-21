const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wave', {
  platform: 'electron',
  testMode: ipcRenderer.sendSync('wave:test-mode'),
  request: (req) => ipcRenderer.invoke('ym:request', req),
  hasToken: () => ipcRenderer.invoke('ym:token:has'),
  setToken: (value) => ipcRenderer.invoke('ym:token:set', value),
  login: (lang) => ipcRenderer.invoke('ym:login', lang),
  log: (level, source, message) => ipcRenderer.send('wave:log', { level, source, message }),
  openLogs: () => ipcRenderer.invoke('wave:logs:open'),
  onCommand: (cb) => ipcRenderer.on('wave:command', (_e, cmd) => cb(cmd)),
  setPlayback: (state) => ipcRenderer.send('wave:playback', state),
  shellPrefs: () => ipcRenderer.sendSync('wave:shell:prefs'),
  setCloseToTray: (enabled) => ipcRenderer.send('wave:shell:close-to-tray', enabled),
  setProgress: (p) => ipcRenderer.send('wave:progress', p),
  openMini: () => ipcRenderer.send('wave:mini:open'),
  updateState: () => ipcRenderer.sendSync('wave:update:state'),
  onUpdate: (cb) => ipcRenderer.on('wave:update', (_e, s) => cb(s)),
  checkUpdate: () => ipcRenderer.send('wave:update:check'),
  installUpdate: () => ipcRenderer.send('wave:update:install'),
  openReleases: () => ipcRenderer.send('wave:update:releases'),
  // used by the mini player window
  miniCommand: (cmd) => ipcRenderer.send('wave:mini:command', cmd),
  miniReady: () => ipcRenderer.send('wave:mini:ready'),
  onPlayback: (cb) => ipcRenderer.on('wave:playback', (_e, s) => cb(s)),
  onProgress: (cb) => ipcRenderer.on('wave:progress', (_e, p) => cb(p)),
});
