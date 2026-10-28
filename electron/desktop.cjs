// Desktop shell around the main window: remembered size and position, taskbar
// thumbnail buttons, the tray, and playback commands sent back to the page.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const discord = require('./discord.cjs');

const asset = (name) => path.join(__dirname, 'assets', name);

/**
 * A window with Oni's bridge (preload.cjs) keeps to Oni's page, and only web addresses go to the
 * browser: another page in the window would have the bridge, and Windows opens a file:// link or
 * another program's own (ms-settings:, …) as well, so a link in a description could start a program.
 */
function keepHome(contents) {
  const outside = (url) => /^https?:\/\//i.test(url) && void shell.openExternal(url);
  contents.setWindowOpenHandler(({ url }) => {
    outside(url);
    return { action: 'deny' };
  });
  // Oni's own page (a #hash, or the dev server's other addresses) may be shown again; nothing else.
  const home = (url) => {
    try {
      const [to, now] = [new URL(url), new URL(contents.getURL())];
      return to.protocol === now.protocol && to.host === now.host && (to.protocol !== 'file:' || to.pathname === now.pathname);
    } catch {
      return false;
    }
  };
  contents.on('will-navigate', (e, url) => {
    if (home(url)) return;
    e.preventDefault();
    outside(url);
  });
}

const prefsFile = () => path.join(app.getPath('userData'), 'shell.json');

/** { bounds, maximized, closeToTray, discord } */
let prefs = {};
let win = null;
let tray = null;
let quitting = false;
/** Last playback state reported by the page, including localized labels. */
let state = { hasTrack: false, playing: false, title: '', artist: '', labels: {} };

/** (level, message) => void; main.cjs points it at the app log. */
let log = () => {};
const setLogger = (fn) => {
  log = fn;
};

const FALLBACK_LABELS = { play: 'Play', pause: 'Pause', next: 'Next track', prev: 'Previous track', show: 'Show Oni', quit: 'Quit', nothing: 'Nothing playing' };
const label = (key) => state.labels?.[key] || FALLBACK_LABELS[key];

function loadPrefs() {
  try {
    prefs = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) || {};
  } catch {
    prefs = {};
  }
}

let saveTimer = null;
function savePrefsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePrefs, 400);
}
function savePrefs() {
  clearTimeout(saveTimer);
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs));
  } catch {
    /* not worth failing over */
  }
}

/** Saved bounds if they still land on a connected display, otherwise the defaults (centered). */
function windowBounds(defaults) {
  loadPrefs();
  const b = prefs.bounds;
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return defaults;
  const area = screen.getDisplayMatching(b).workArea;
  const onScreen = b.x < area.x + area.width - 120 && b.x + b.width > area.x + 120 && b.y >= area.y - 20 && b.y < area.y + area.height - 80;
  if (!onScreen) return defaults;
  return { x: b.x, y: b.y, width: Math.min(b.width, area.width), height: Math.min(b.height, area.height) };
}

const playing = () => (state.hasTrack ? `${state.title} — ${state.artist}` : '');

function command(cmd) {
  if (win && !win.isDestroyed()) win.webContents.send('wave:command', cmd);
}

function showWindow() {
  // While the mini player is open the main window waits in the tray: closing the mini player brings it back.
  if (mini && !mini.isDestroyed()) return closeMini();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function updateThumbar() {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || !win.isVisible()) return;
  const flags = state.hasTrack ? [] : ['disabled'];
  win.setThumbarButtons([
    { tooltip: label('prev'), icon: nativeImage.createFromPath(asset('prev.png')), click: () => command('prev'), flags },
    {
      tooltip: state.playing ? label('pause') : label('play'),
      icon: nativeImage.createFromPath(asset(state.playing ? 'pause.png' : 'play.png')),
      click: () => command('toggle'),
      flags,
    },
    { tooltip: label('next'), icon: nativeImage.createFromPath(asset('next.png')), click: () => command('next'), flags },
  ]);
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip((playing() || 'Oni').slice(0, 127));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: playing() || label('nothing'), enabled: false },
      { type: 'separator' },
      { label: state.playing ? label('pause') : label('play'), enabled: state.hasTrack, click: () => command('toggle') },
      { label: label('next'), enabled: state.hasTrack, click: () => command('next') },
      { label: label('prev'), enabled: state.hasTrack, click: () => command('prev') },
      { type: 'separator' },
      { label: label('show'), click: showWindow },
      { label: label('quit'), click: () => app.quit() },
    ]),
  );
}

/** The tray icon is there with "close to tray" on, and always while the mini player is open. */
const syncTray = () => setTray(Boolean(prefs.closeToTray) || Boolean(mini && !mini.isDestroyed()) || startedHidden);

/** Started with Windows (--hidden): the window waits in the tray, so the tray icon is there all
 * the session, as the way to it. */
const startedHidden = process.argv.includes('--hidden');
/** Started with Windows: the same exe, told to stay in the tray. */
const LOGIN = { args: ['--hidden'] };

function setTray(enabled) {
  if (enabled && !tray) {
    tray = new Tray(asset('tray.ico'));
    tray.on('click', () => (win?.isVisible() && !win.isMinimized() ? win.hide() : showWindow()));
    updateTray();
  } else if (!enabled && tray) {
    tray.destroy();
    tray = null;
  }
}

/** Wires the shell to the main window. Call once, right after it is created. */
function attachWindow(w) {
  win = w;
  if (prefs.maximized) w.maximize();

  const remember = () => {
    if (w.isDestroyed() || w.isMinimized()) return;
    prefs.maximized = w.isMaximized();
    if (!prefs.maximized && !w.isFullScreen()) prefs.bounds = w.getNormalBounds();
    savePrefsSoon();
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) w.on(ev, remember);

  // The title shows the current track (it is what the taskbar shows); the page's <title> must not reset it.
  w.on('page-title-updated', (e) => e.preventDefault());
  // Windows drops thumbnail buttons whenever the window is hidden.
  w.on('show', updateThumbar);
  w.once('ready-to-show', updateThumbar);

  // Mouse side buttons on Windows also arrive as app commands.
  w.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') command('back');
    else if (cmd === 'browser-forward') command('forward');
  });

  w.on('close', (e) => {
    if (prefs.closeToTray && tray && !quitting) {
      e.preventDefault();
      w.hide();
      return;
    }
    remember();
    savePrefs();
  });
  syncTray();
}

app.on('before-quit', () => {
  quitting = true;
});

// ---------------------------------------------------------------- mini player
// A small always-on-top window that remote-controls the main one: the music keeps playing
// in the main window (hidden meanwhile); state comes here, commands go back.

let mini = null;
let progress = null;

const MINI = { width: 380, height: 112 };

function miniBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const b = prefs.miniBounds;
  if (b && Number.isFinite(b.x)) {
    const shown = screen.getDisplayMatching({ ...b, ...MINI }).workArea;
    if (b.x >= shown.x - 40 && b.x + MINI.width <= shown.x + shown.width + 40 && b.y >= shown.y - 20 && b.y + MINI.height <= shown.y + shown.height + 40) return { x: b.x, y: b.y, ...MINI };
  }
  return { x: area.x + area.width - MINI.width - 24, y: area.y + area.height - MINI.height - 24, ...MINI };
}

// While the mini player is open the main window waits in the tray, so there is always a way
// back to Oni, whatever happens to the mini window; the tray icon brings it back.
const MINI_SHOW_TIMEOUT = 8000;

function closeMini(reason) {
  if (!mini || mini.isDestroyed()) return;
  if (reason) log('warn', `mini player closed: ${reason}`);
  mini.destroy();
}

function openMini() {
  if (mini && !mini.isDestroyed()) return mini.focus();
  mini = new BrowserWindow({
    ...miniBounds(),
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Oni',
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    icon: asset('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  keepHome(mini.webContents);
  if (process.env.VITE_DEV_URL) mini.loadURL(`${process.env.VITE_DEV_URL}#mini`);
  else mini.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'mini' });
  const self = mini;
  const notShown = setTimeout(() => self === mini && closeMini('did not show up'), MINI_SHOW_TIMEOUT);
  mini.once('ready-to-show', () => {
    clearTimeout(notShown);
    mini.showInactive();
    const b = mini.getBounds();
    log('info', `mini player opened at ${b.x},${b.y} on display ${screen.getDisplayMatching(b).id}`);
    syncTray();
    if (win && !win.isDestroyed()) win.hide();
  });
  // A dead page leaves an empty see-through window: close it and bring the main one back.
  mini.webContents.on('render-process-gone', (_e, details) => closeMini(`page gone: ${details.reason} (exit ${details.exitCode})`));
  mini.on('unresponsive', () => closeMini('not responding'));
  mini.on('moved', () => {
    prefs.miniBounds = mini.getBounds();
    savePrefs();
  });
  mini.on('closed', () => {
    clearTimeout(notShown);
    mini = null;
    syncTray();
    showWindow();
  });
}

const toMini = (channel, payload) => mini && !mini.isDestroyed() && mini.webContents.send(channel, payload);

ipcMain.on('wave:mini:open', openMini);
// The mini page asks once its listeners are in place; anything sent before that is lost.
ipcMain.on('wave:mini:ready', (e) => {
  e.sender.send('wave:playback', state);
  if (progress) e.sender.send('wave:progress', progress);
});
ipcMain.on('wave:mini:command', (_e, cmd) => {
  if (cmd === 'expand' || cmd === 'close') mini?.close();
  else if (['toggle', 'next', 'prev', 'like'].includes(cmd)) command(cmd);
});
ipcMain.on('wave:progress', (_e, p) => {
  progress = p;
  toMini('wave:progress', p);
});

ipcMain.on('wave:playback', (_e, s) => {
  state = { ...state, ...s };
  if (win && !win.isDestroyed()) win.setTitle(playing() || 'Oni');
  updateThumbar();
  updateTray();
  toMini('wave:playback', state);
});
ipcMain.on('wave:shell:prefs', (e) => {
  e.returnValue = { closeToTray: Boolean(prefs.closeToTray), autostart: app.getLoginItemSettings(LOGIN).openAtLogin, discord: prefs.discord !== false };
});

// Discord's status (discord.cjs): on unless turned off in Settings. The page sends what plays.
// Tests talk to it only through a pipe of their own (not to the user's Discord).
const discordOn = () => prefs.discord !== false && (!process.env.WAVE_E2E || Boolean(process.env.ONI_DISCORD_PIPE));
let discordStarted = false;
const startDiscord = () => {
  if (discordStarted || !discordOn()) return;
  discordStarted = true;
  discord.init(log, true);
};
ipcMain.on('wave:discord', (_e, track) => {
  if (!discordOn()) return;
  startDiscord();
  discord.setTrack(track);
});
ipcMain.on('wave:shell:discord', (_e, enabled) => {
  prefs.discord = Boolean(enabled);
  savePrefs();
  if (discordStarted) discord.setEnabled(discordOn());
});
// "Start with Windows": a login item that opens Oni in the tray (the user's wish).
ipcMain.on('wave:shell:autostart', (_e, enabled) => {
  app.setLoginItemSettings({ ...LOGIN, openAtLogin: Boolean(enabled) });
});
ipcMain.on('wave:shell:close-to-tray', (_e, enabled) => {
  prefs.closeToTray = Boolean(enabled);
  savePrefs();
  syncTray();
});

/** For tests: whether the tray icon is there. */
const hasTray = () => Boolean(tray);

module.exports = { windowBounds, keepHome, attachWindow, showWindow, openMini, asset, setLogger, hasTray, startedHidden };
