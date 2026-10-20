// Desktop shell around the main window: remembered size and position, taskbar
// thumbnail buttons, the tray, and playback commands sent back to the page.
const { app, Menu, Tray, ipcMain, nativeImage, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const asset = (name) => path.join(__dirname, 'assets', name);
const prefsFile = () => path.join(app.getPath('userData'), 'shell.json');

/** { bounds, maximized, closeToTray } */
let prefs = {};
let win = null;
let tray = null;
let quitting = false;
/** Last playback state reported by the page, including localized labels. */
let state = { hasTrack: false, playing: false, title: '', artist: '', labels: {} };

const FALLBACK_LABELS = { play: 'Play', pause: 'Pause', next: 'Next track', prev: 'Previous track', show: 'Show Wave', quit: 'Quit', nothing: 'Nothing playing' };
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
  tray.setToolTip((playing() || 'Wave').slice(0, 127));
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

  w.on('close', (e) => {
    if (prefs.closeToTray && tray && !quitting) {
      e.preventDefault();
      w.hide();
      return;
    }
    remember();
    savePrefs();
  });
  setTray(Boolean(prefs.closeToTray));
}

app.on('before-quit', () => {
  quitting = true;
});

ipcMain.on('wave:playback', (_e, s) => {
  state = { ...state, ...s };
  if (win && !win.isDestroyed()) win.setTitle(playing() || 'Wave');
  updateThumbar();
  updateTray();
});
ipcMain.on('wave:shell:prefs', (e) => {
  e.returnValue = { closeToTray: Boolean(prefs.closeToTray) };
});
ipcMain.on('wave:shell:close-to-tray', (_e, enabled) => {
  prefs.closeToTray = Boolean(enabled);
  savePrefs();
  setTray(prefs.closeToTray);
});

module.exports = { windowBounds, attachWindow, showWindow, asset };
