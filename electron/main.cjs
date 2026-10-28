// Electron main process: window, secure token storage and network transport.
// All Yandex requests go through here so the renderer is not limited by CORS
// and the OAuth token never has to live in page JavaScript.
const { app, BrowserWindow, ipcMain, safeStorage, session, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const desktop = require('./desktop.cjs');
const updater = require('./updater.cjs');
const { setupLan } = require('./lan.cjs');

// The app was called Wave before it became Oni; keep its data folder so the sign-in,
// history and settings survive the rename.
app.setPath('userData', process.env.WAVE_USER_DATA || path.join(app.getPath('appData'), 'Wave'));
// Automated UI test: silent, and the renderer won't send wave feedback to the real account.
const TEST_MODE = process.env.WAVE_E2E === '1';
if (TEST_MODE) app.commandLine.appendSwitch('mute-audio');

// Must match build.appId so the taskbar ties the window to the installed shortcut.
if (process.platform === 'win32') app.setAppUserModelId('local.wave.player');

// In-memory session (no "persist:" prefix): Yandex cookies never reach the disk.
const LOGIN_PARTITION = 'yandex-login';
const OAUTH_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d'; // official Yandex Music client
/** Oni's own app at oauth.yandex.ru (made by the user): only its folder on Yandex Disk, for the shared history. */
const DISK_CLIENT_ID = 'e3a9ad75307d4369a7b9250d0be40af2';
const DEFAULT_CLIENT = 'YandexMusicAndroid/24023621';

let mainWindow = null;
let token = null;
let diskToken = null;
/** Tests only (WAVE_E2E): every request fails as with no network. WAVE_E2E_OFFLINE=1 starts that way. */
let networkDown = TEST_MODE && process.env.WAVE_E2E_OFFLINE === '1';

// ------------------------------------------------------------------ error log

const LOG_LIMIT = 1024 * 1024;
const logDir = () => path.join(app.getPath('userData'), 'logs');
const logFile = () => path.join(logDir(), 'wave.log');

function writeLog(level, source, message) {
  try {
    fs.mkdirSync(logDir(), { recursive: true });
    const file = logFile();
    // Keep one previous file so the log never grows without bound.
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_LIMIT) fs.renameSync(file, path.join(logDir(), 'wave.old.log'));
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${source}: ${String(message).slice(0, 8000)}\n`);
  } catch {
    /* logging must never take the app down */
  }
}

desktop.setLogger((level, message) => writeLog(level, 'shell', message));
process.on('uncaughtException', (e) => writeLog('error', 'main', e?.stack || e));
process.on('unhandledRejection', (e) => writeLog('error', 'main', e?.stack || e));

// ---------------------------------------------------------------- token store

const tokenFile = () => path.join(app.getPath('userData'), 'token.bin');

function loadToken() {
  try {
    const raw = fs.readFileSync(tokenFile());
    token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch {
    // Development and tests only: an installed app always signs in through Yandex,
    // so whoever runs it uses their own account and "Sign out" really signs out.
    token = (!app.isPackaged && process.env.YANDEX_MUSIC_TOKEN) || null;
  }
}

function saveToken(value) {
  token = value;
  if (!value) {
    fs.rmSync(tokenFile(), { force: true });
    // Forget the Yandex web session too, or the next sign-in silently reuses the same account.
    session.fromPartition(LOGIN_PARTITION).clearStorageData().catch(() => {});
    return;
  }
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
  fs.writeFileSync(tokenFile(), data);
}

// Yandex Disk (src/sync): a token of its own, kept the same way.
const diskTokenFile = () => path.join(app.getPath('userData'), 'disk-token.bin');

function loadDiskToken() {
  try {
    const raw = fs.readFileSync(diskTokenFile());
    diskToken = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch {
    diskToken = (!app.isPackaged && process.env.YANDEX_DISK_TOKEN) || null;
  }
}

function saveDiskToken(value) {
  diskToken = value;
  if (!value) return fs.rmSync(diskTokenFile(), { force: true });
  fs.writeFileSync(diskTokenFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8'));
}

// ------------------------------------------------------------------ transport

function needsAuth(url) {
  const host = new URL(url).hostname;
  return host === 'api.music.yandex.net' || host.endsWith('.music.yandex.net') || host.endsWith('.music.yandex.ru');
}

async function request(req) {
  if (networkDown) throw new TypeError('fetch failed');
  const url = new URL(req.url);
  for (const [k, v] of Object.entries(req.query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { ...req.headers };
  if (needsAuth(url.href)) {
    if (token) headers.Authorization = `OAuth ${token}`;
    headers['X-Yandex-Music-Client'] ??= DEFAULT_CLIENT;
  } else if (url.hostname === 'cloud-api.yandex.net' && diskToken) headers.Authorization = `OAuth ${diskToken}`;

  let body;
  if (req.form) {
    body = new URLSearchParams();
    for (const [k, v] of Object.entries(req.form)) body.set(k, String(v));
  } else if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    headers['Content-Type'] = 'application/json';
  } else if (req.body !== undefined) {
    body = req.body;
  } else if (req.multipart) {
    const { field, filename, contentType, data } = req.multipart;
    body = new FormData();
    body.set(field, new Blob([data], { type: contentType }), filename);
  }

  const method = req.method || (body ? 'POST' : 'GET');
  // A read not answered (the connection dropped: "fetch failed") is tried twice more — through a VPN
  // Yandex's servers now and then drop one (the user's picture of a friend's uploads, 27.10.2026).
  // A write is not: it may have been done.
  let resp;
  for (let i = 1; ; i++) {
    try {
      resp = await fetch(url, { method, headers, body });
      break;
    } catch (e) {
      if (method === 'GET' && i < 3 && !networkDown) continue;
      throw e;
    }
  }
  const text = await resp.text();
  let data = text;
  if (req.responseType !== 'text') {
    try {
      data = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  return { status: resp.status, ok: resp.ok, data };
}

// ---------------------------------------------------------------- OAuth login

/**
 * lang: the interface language ('ru' | 'en'); the Yandex sign-in page follows it, not the system's.
 * The same window gives the Disk token, with Oni's own client and its own store.
 */
function login(lang, clientId = OAUTH_CLIENT_ID, save = saveToken) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 720,
      parent: mainWindow,
      modal: true,
      title: 'Вход в Яндекс',
      backgroundColor: '#111',
      autoHideMenuBar: true,
      webPreferences: { partition: LOGIN_PARTITION },
    });
    const language = lang === 'en' ? 'en-US,en;q=0.9' : 'ru-RU,ru;q=0.9';
    win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'Accept-Language': language } });
    });
    let done = false;
    const check = (target) => {
      const m = /[#&?]access_token=([^&]+)/.exec(target);
      if (m && !done) {
        done = true;
        save(decodeURIComponent(m[1]));
        resolve(true);
        win.close();
      }
    };
    for (const ev of ['will-redirect', 'will-navigate', 'did-navigate', 'did-navigate-in-page']) {
      win.webContents.on(ev, (_e, target) => check(target));
    }
    win.on('closed', () => !done && resolve(false));
    win.loadURL(`https://oauth.yandex.ru/authorize?response_type=token&client_id=${clientId}`);
  });
}

// ---------------------------------------------------------------------- window

function createWindow() {
  nativeTheme.themeSource = 'dark';
  mainWindow = new BrowserWindow({
    ...desktop.windowBounds({ width: 1320, height: 840 }),
    minWidth: 960,
    minHeight: 620,
    title: 'Oni',
    show: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e8e8f0', height: 44 },
    icon: desktop.asset('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  desktop.attachWindow(mainWindow);
  // Started with Windows: it stays in the tray until opened from there.
  mainWindow.once('ready-to-show', () => !desktop.startedHidden && mainWindow.show());
  // A crashed renderer leaves an empty see-through window: log it and load the page again.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    writeLog('error', 'renderer', `process gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason !== 'clean-exit' && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  });
  mainWindow.on('unresponsive', () => writeLog('warn', 'renderer', 'window is not responding'));
  desktop.keepHome(mainWindow.webContents);
  if (process.env.VITE_DEV_URL) mainWindow.loadURL(process.env.VITE_DEV_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

/**
 * Yandex's audio CDN sends no CORS headers, and Web Audio (the equalizer) only hears a
 * cross-origin stream when it is CORS-enabled — otherwise it gets silence. Add the header
 * to those responses; the page loads audio with crossOrigin="anonymous".
 */
function allowAudioAnalysis() {
  const filter = { urls: ['https://*.strm.yandex.net/*', 'https://*.strm.yandex.ru/*', 'https://*.storage.yandex.net/*'] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const headers = { ...details.responseHeaders };
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'access-control-allow-origin')) headers['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders: headers });
  });
}

// ------------------------------------------------------------ offline files

// Downloaded tracks (src/player/offline.ts): encrypted by the page, kept here.
const offlineDir = () => path.join(app.getPath('userData'), 'offline');
function offlinePath(name) {
  // Only our own "<track id>.oni" files and their covers ("<track id>.jpg"): nothing like "../x"
  // gets out of the folder.
  if (!/^[\w-]+\.(oni|jpg)$/.test(String(name))) throw new Error('bad file name');
  return path.join(offlineDir(), name);
}

ipcMain.handle('wave:files:write', async (_e, name, data) => {
  await fs.promises.mkdir(offlineDir(), { recursive: true });
  await fs.promises.writeFile(offlinePath(name), Buffer.from(data));
});
ipcMain.handle('wave:files:read', async (_e, name) => {
  const b = await fs.promises.readFile(offlinePath(name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
ipcMain.handle('wave:files:remove', (_e, name) => fs.promises.rm(offlinePath(name), { force: true }));
ipcMain.handle('wave:files:list', async () => {
  const names = await fs.promises.readdir(offlineDir()).catch(() => []);
  return Promise.all(names.map(async (name) => ({ name, size: (await fs.promises.stat(path.join(offlineDir(), name))).size })));
});
ipcMain.handle('wave:fetch-bytes', async (_e, url) => {
  if (networkDown) throw new TypeError('fetch failed');
  if (new URL(url).protocol !== 'https:') throw new Error('https only');
  // A server not reached is tried twice more: through a VPN some of Yandex's are now and then
  // (27.10.2026); an answer, even a refusal, is final.
  for (let i = 1; ; i++) {
    let r;
    try {
      r = await fetch(url);
    } catch (e) {
      if (i < 3 && !networkDown) continue;
      throw e;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  }
});
// Tests only: requests fail as with no network, to check the offline mode.
ipcMain.on('wave:test:network', (_e, up) => {
  if (TEST_MODE) networkDown = !up;
});

ipcMain.handle('ym:request', (_e, req) => request(req));
ipcMain.handle('ym:token:has', () => Boolean(token));
ipcMain.on('wave:test-mode', (e) => (e.returnValue = TEST_MODE));
ipcMain.handle('ym:token:set', (_e, value) => saveToken(value ? String(value).trim() : null));
ipcMain.handle('ym:login', (_e, lang) => login(lang));
ipcMain.handle('disk:token:has', () => Boolean(diskToken));
ipcMain.handle('disk:token:set', (_e, value) => saveDiskToken(value ? String(value).trim() : null));
ipcMain.handle('disk:login', (_e, lang) => login(lang, DISK_CLIENT_ID, saveDiskToken));
setupLan(() => mainWindow, { testMode: TEST_MODE, writeLog });
ipcMain.on('wave:log', (_e, entry) => writeLog(entry?.level || 'error', entry?.source || 'ui', entry?.message));
ipcMain.handle('wave:logs:open', () => {
  if (!fs.existsSync(logFile())) writeLog('info', 'main', 'log opened');
  return shell.openPath(logFile());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => desktop.showWindow());
  app.whenReady().then(() => {
    allowAudioAnalysis();
    loadToken();
    loadDiskToken();
    createWindow();
    updater.init(
      (level, message) => writeLog(level, 'update', message),
      (state) => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('wave:update', state),
    );
  });
  app.on('window-all-closed', () => app.quit());
}
