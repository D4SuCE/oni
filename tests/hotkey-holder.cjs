// Another program holding a global key (for tests/desktop.mjs): registers the key given and waits
// until killed. Run: electron tests/hotkey-holder.cjs Control+Alt+K
const { app, globalShortcut } = require('electron');
app.whenReady().then(() => console.log(globalShortcut.register(process.argv.at(-1), () => {}) ? 'held' : 'taken'));
app.on('window-all-closed', () => {});
