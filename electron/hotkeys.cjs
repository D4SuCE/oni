// Global hotkeys: playback keys that work while Oni is in the background or in the tray
// (globalShortcut). The set and the keys live in hotkeys.json; the page changes them in Settings.
// A key another program holds can't be taken: register() says no, and Settings shows it as busy.
const { app, globalShortcut, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** Action → Electron accelerator ('' — none). Ctrl+Alt: rarely taken by other programs (Ctrl+Alt+Space
 * often is — found on the user's PC). */
const DEFAULTS = {
  toggle: 'Control+Alt+P',
  next: 'Control+Alt+Right',
  prev: 'Control+Alt+Left',
  volumeUp: 'Control+Alt+Up',
  volumeDown: 'Control+Alt+Down',
  like: 'Control+Alt+L',
};

const file = () => path.join(app.getPath('userData'), 'hotkeys.json');

/** { enabled, keys } */
let prefs = { enabled: true, keys: { ...DEFAULTS } };
/** Actions whose keys another program holds. */
let busy = [];
/** While Settings waits for a new key, ours are off (or pressing one would run it). */
let paused = false;
/** Off in tests that didn't ask for the real keys. */
let live = false;
let run = () => {};
let log = () => {};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8')) || {};
    prefs = { enabled: saved.enabled !== false, keys: { ...DEFAULTS, ...saved.keys } };
  } catch {
    /* first start: the defaults */
  }
}

function save() {
  try {
    fs.writeFileSync(file(), JSON.stringify(prefs));
  } catch {
    /* not worth failing over */
  }
}

function apply() {
  if (!live) return;
  globalShortcut.unregisterAll();
  busy = [];
  if (!prefs.enabled || paused) return;
  for (const [action, key] of Object.entries(prefs.keys)) {
    if (!key || !(action in DEFAULTS)) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(key, () => run(action));
    } catch {
      /* a key Electron can't take */
    }
    if (!ok) busy.push(action);
  }
  if (busy.length) log('warn', `hotkeys taken by other programs: ${busy.map((a) => `${a} (${prefs.keys[a]})`).join(', ')}`);
}

const state = () => ({ enabled: prefs.enabled, keys: prefs.keys, defaults: DEFAULTS, busy });

/**
 * Starts the hotkeys (after app ready). `onAction(action)` runs one; `logger(level, message)`.
 * Tests (WAVE_E2E) leave the user's keys alone unless ONI_HOTKEYS=1 asks for them.
 */
function init(onAction, logger) {
  run = onAction;
  log = logger || log;
  load();
  live = !process.env.WAVE_E2E || process.env.ONI_HOTKEYS === '1';
  apply();
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

ipcMain.on('wave:hotkeys:get', (e) => {
  e.returnValue = state();
});
ipcMain.handle('wave:hotkeys:set', (_e, next) => {
  if (typeof next?.enabled === 'boolean') prefs.enabled = next.enabled;
  if (next?.keys) for (const [a, k] of Object.entries(next.keys)) if (a in DEFAULTS && typeof k === 'string') prefs.keys[a] = k;
  // A new key ends the wait for it: registered now, so the answer says whether it is taken.
  paused = false;
  save();
  apply();
  return state();
});
ipcMain.on('wave:hotkeys:pause', (_e, on) => {
  paused = Boolean(on);
  apply();
});

/** For tests: runs an action as its key would. */
const press = (action) => run(action);

module.exports = { init, press, DEFAULTS };
