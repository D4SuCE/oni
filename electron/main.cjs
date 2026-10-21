// Electron main process: window, secure token storage and network transport.
// All Yandex requests go through here so the renderer is not limited by CORS
// and the OAuth token never has to live in page JavaScript.
const { app, BrowserWindow, ipcMain, safeStorage, session, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const desktop = require('./desktop.cjs');
const updater = require('./updater.cjs');

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
const DEFAULT_CLIENT = 'YandexMusicAndroid/24023621';

let mainWindow = null;
let token = null;

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

// ------------------------------------------------------------------ transport

function needsAuth(url) {
  const host = new URL(url).hostname;
  return host === 'api.music.yandex.net' || host.endsWith('.music.yandex.net') || host.endsWith('.music.yandex.ru');
}

async function request(req) {
  const url = new URL(req.url);
  for (const [k, v] of Object.entries(req.query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { ...req.headers };
  if (needsAuth(url.href)) {
    if (token) headers.Authorization = `OAuth ${token}`;
    headers['X-Yandex-Music-Client'] ??= DEFAULT_CLIENT;
  }

  let body;
  if (req.form) {
    body = new URLSearchParams();
    for (const [k, v] of Object.entries(req.form)) body.set(k, String(v));
  } else if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    headers['Content-Type'] = 'application/json';
  } else if (req.multipart) {
    const { field, filename, contentType, data } = req.multipart;
    body = new FormData();
    body.set(field, new Blob([data], { type: contentType }), filename);
  }

  const resp = await fetch(url, { method: req.method || (body ? 'POST' : 'GET'), headers, body });
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

function login() {
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
    let done = false;
    const check = (target) => {
      const m = /[#&?]access_token=([^&]+)/.exec(target);
      if (m && !done) {
        done = true;
        saveToken(decodeURIComponent(m[1]));
        resolve(true);
        win.close();
      }
    };
    for (const ev of ['will-redirect', 'will-navigate', 'did-navigate', 'did-navigate-in-page']) {
      win.webContents.on(ev, (_e, target) => check(target));
    }
    win.on('closed', () => !done && resolve(false));
    win.loadURL(`https://oauth.yandex.ru/authorize?response_type=token&client_id=${OAUTH_CLIENT_ID}`);
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
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // A crashed renderer leaves an empty see-through window: log it and load the page again.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    writeLog('error', 'renderer', `process gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason !== 'clean-exit' && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
  });
  mainWindow.on('unresponsive', () => writeLog('warn', 'renderer', 'window is not responding'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
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

ipcMain.handle('ym:request', (_e, req) => request(req));
ipcMain.handle('ym:token:has', () => Boolean(token));
ipcMain.on('wave:test-mode', (e) => (e.returnValue = TEST_MODE));
ipcMain.handle('ym:token:set', (_e, value) => saveToken(value ? String(value).trim() : null));
ipcMain.handle('ym:login', () => login());
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
    createWindow();
    updater.init(
      (level, message) => writeLog(level, 'update', message),
      (state) => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('wave:update', state),
    );
  });
  app.on('window-all-closed', () => app.quit());
}
