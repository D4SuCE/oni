// Desktop shell test: remembered window bounds, track in the window title, taskbar
// commands, and close-to-tray. Needs YANDEX_MUSIC_TOKEN like e2e.mjs; muted, isolated profile.
// Run: npm run test:e2e (runs after e2e.mjs)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-desktop-'));
let passed = 0;
let failed = 0;

async function launch() {
  const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData } });
  const page = await app.firstWindow();
  await page.waitForSelector('.wave-hero', { timeout: 30000 });
  return { app, page };
}

/** Runs fn(window, arg) in the main process against the main window (not the #mini one). */
const win = (app, fn, arg) =>
  app.evaluate(
    ({ BrowserWindow }, [src, a]) => {
      const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('#mini'));
      return new Function('w', 'a', `return (${src})(w, a)`)(main, a);
    },
    [fn.toString(), arg],
  );

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.message || e}`);
  }
}

let { app, page } = await launch();

await step('window bounds survive a restart', async () => {
  const want = { x: 140, y: 90, width: 1100, height: 700 };
  await win(app, (w, b) => w.setBounds(b), want);
  await page.waitForTimeout(800);
  await app.close();
  ({ app, page } = await launch());
  const got = await win(app, (w) => w.getBounds());
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`got ${JSON.stringify(got)}`);
});

await step('window title shows the playing track', async () => {
  await page.click('[data-testid="wave-play"]');
  await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.audio.currentTime > 1, null, { timeout: 30000 });
  const title = await page.evaluate(() => {
    const s = window.__wave.usePlayer.getState();
    return s.queue[s.index].title;
  });
  await page.waitForTimeout(300);
  const windowTitle = await win(app, (w) => w.getTitle());
  if (!windowTitle.startsWith(title)) throw new Error(`window title "${windowTitle}", track "${title}"`);
});

await step('taskbar commands drive the player', async () => {
  await win(app, (w) => w.webContents.send('wave:command', 'toggle'));
  await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 5000 });
  const before = await page.evaluate(() => window.__wave.usePlayer.getState().index);
  await win(app, (w) => w.webContents.send('wave:command', 'next'));
  await page.waitForFunction((i) => window.__wave.usePlayer.getState().index > i, before, { timeout: 20000 });
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('mini player: remote for the hidden main window', async () => {
  await page.evaluate(() => window.__wave.audio.play());
  await page.waitForFunction(() => !window.__wave.audio.paused, null, { timeout: 10000 });
  const opened = app.waitForEvent('window');
  await page.click('[data-testid="mini-button"]');
  const mini = await opened;
  await mini.waitForSelector('[data-testid="mini"]');
  const title = await page.evaluate(() => {
    const s = window.__wave.usePlayer.getState();
    return s.queue[s.index].title;
  });
  await mini.waitForFunction((t) => document.querySelector('[data-testid="mini-title"]')?.textContent === t, title, { timeout: 5000 });
  await page.waitForTimeout(500);
  if (await win(app, (w) => w.isVisible())) throw new Error('main window should hide');
  await mini.click('[data-testid="mini-toggle"]');
  await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 5000 });
  const closed = new Promise((r) => mini.once('close', r));
  // the click closes this very window, so don't wait on it afterwards
  await mini.click('[data-testid="mini-expand"]', { noWaitAfter: true }).catch(() => {});
  await closed;
  await page.waitForTimeout(500);
  if (!(await win(app, (w) => w.isVisible()))) throw new Error('main window should come back');
});

await step('close-to-tray hides the window, and closing quits without it', async () => {
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  await page.locator('[data-testid="close-to-tray"]').check();
  await page.waitForTimeout(300);
  await win(app, (w) => w.close());
  await page.waitForTimeout(800);
  if (await win(app, (w) => w.isVisible())) throw new Error('window still visible');
  await win(app, (w) => w.show());
  await page.locator('[data-testid="close-to-tray"]').uncheck();
  await page.waitForTimeout(300);
  const exited = new Promise((r) => app.process().once('exit', () => r(true)));
  await win(app, (w) => w.close());
  if (!(await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 8000))]))) throw new Error('app did not quit');
});

await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
