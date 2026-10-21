// Auto-update from GitHub Releases (build.publish in package.json). The installed app
// checks on start and every few hours, downloads in the background and installs on the
// next quit, or right away from Settings. The portable exe can't replace itself: it only
// reports itself as such, and the page links to the releases.
const { app, ipcMain, shell } = require('electron');

const RELEASES_URL = 'https://github.com/D4SuCE/oni-releases/releases';
const FIRST_CHECK = 10 * 1000;
const RECHECK = 6 * 60 * 60 * 1000;

/** { status: 'off' | 'portable' | 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error', version?, percent?, error? } */
let state = { status: 'off' };
let send = () => {};
let updater = null;

function set(next) {
  state = next;
  send(state);
}

function check() {
  if (!updater || state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
  updater.checkForUpdates().catch(() => {
    /* reported through the 'error' event */
  });
}

/**
 * @param log (level, message) => void, writes to the app log
 * @param broadcast (state) => void, delivers the state to the main window
 */
function init(log, broadcast) {
  send = broadcast;
  // Tests pass their own app-update.yml with a local feed; without it, only the installed app updates.
  const testConfig = process.env.ONI_UPDATE_CONFIG;
  if (process.env.PORTABLE_EXECUTABLE_DIR) return set({ status: 'portable' });
  if (!app.isPackaged && !testConfig) return;

  ({ autoUpdater: updater } = require('electron-updater'));
  updater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => {} };
  updater.autoDownload = true;
  updater.disableWebInstaller = true;
  // A test feed serves a dummy file: never run it.
  updater.autoInstallOnAppQuit = !testConfig;
  if (testConfig) {
    updater.forceDevUpdateConfig = true;
    updater.updateConfigPath = testConfig;
  }

  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => set({ status: 'latest' }));
  updater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
  updater.on('download-progress', (p) => set({ ...state, status: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }));
  // Offline or GitHub unreachable: say so in Settings and try again on the next round.
  updater.on('error', (e) => set({ status: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) }));

  set({ status: 'idle' });
  setTimeout(check, testConfig ? 0 : FIRST_CHECK);
  setInterval(check, RECHECK).unref();
}

ipcMain.on('wave:update:state', (e) => (e.returnValue = state));
ipcMain.on('wave:update:check', check);
ipcMain.on('wave:update:install', () => {
  // Silent install, then start the new version.
  if (state.status === 'ready') updater.quitAndInstall(true, true);
});
ipcMain.on('wave:update:releases', () => shell.openExternal(RELEASES_URL));

module.exports = { init };
