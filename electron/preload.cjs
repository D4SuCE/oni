const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wave', {
  platform: 'electron',
  testMode: ipcRenderer.sendSync('wave:test-mode'),
  request: (req) => ipcRenderer.invoke('ym:request', req),
  hasToken: () => ipcRenderer.invoke('ym:token:has'),
  setToken: (value) => ipcRenderer.invoke('ym:token:set', value),
  login: () => ipcRenderer.invoke('ym:login'),
  log: (level, source, message) => ipcRenderer.send('wave:log', { level, source, message }),
  openLogs: () => ipcRenderer.invoke('wave:logs:open'),
});
