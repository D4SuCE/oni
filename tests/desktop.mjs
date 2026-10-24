// Desktop shell test: remembered window bounds, track in the window title, taskbar
// commands, the mini player (and what happens if its window dies), and close-to-tray. Needs YANDEX_MUSIC_TOKEN like e2e.mjs; muted, isolated profile.
// Run: npm run test:e2e (runs after e2e.mjs)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-desktop-'));
let passed = 0;
let failed = 0;

async function launch(env = {}) {
  const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData, ...env } });
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

/** Opens the mini player from the main window and waits for its page. */
async function openMini() {
  const opened = app.waitForEvent('window');
  await page.click('[data-testid="mini-button"]');
  const mini = await opened;
  await mini.waitForSelector('[data-testid="mini"]');
  await page.waitForTimeout(500);
  return mini;
}
const mainShown = () => win(app, (w) => w.isVisible() && !w.isMinimized());
const miniOpen = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#mini')));
/** Calls into electron/desktop.cjs as loaded by the app (the tray itself can't be clicked from here). */
const shellModule = path.join(root, 'electron', 'desktop.cjs');
const shell = (fn) => app.evaluate((_e, [file, name]) => process.mainModule.require(file)[name](), [shellModule, fn]);

await step('mini player with nothing playing puts Oni in the tray; a crash brings the main window back', async () => {
  if (await shell('hasTray')) throw new Error('tray icon without close-to-tray and mini player');
  const mini = await openMini();
  const text = await mini.locator('[data-testid="mini-title"]').innerText();
  if (!/Ничего не играет/.test(text)) throw new Error(`mini title "${text}"`);
  // Never no way back: the main window waits in the tray.
  if (await mainShown()) throw new Error('main window should be in the tray');
  if (!(await shell('hasTray'))) throw new Error('no tray icon while the mini player is open');
  // The mini's page dies: the app must not be left with no window to click.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#mini')).webContents.forcefullyCrashRenderer());
  await page.waitForTimeout(1500);
  if (await miniOpen()) throw new Error('crashed mini window still open');
  if (!(await mainShown())) throw new Error('main window did not come back');
  if (await shell('hasTray')) throw new Error('tray icon left behind');
});

await step('the tray icon brings the main window back and closes the mini player', async () => {
  await openMini();
  await shell('showWindow'); // what a click on the tray icon (or "Show", or starting Oni again) does
  await page.waitForTimeout(1000);
  if (await miniOpen()) throw new Error('mini still open');
  if (!(await mainShown())) throw new Error('main window not shown');
  if (await shell('hasTray')) throw new Error('tray icon left behind');
});

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

await step('after a restart My Wave goes on: next keeps loading new tracks', async () => {
  // The user: start the wave, restart Oni, play, skip a couple of tracks: nothing more came, and
  // only "My Wave" brought it back. The restored queue was taken for a plain list.
  await page.waitForTimeout(1500); // the queue is saved a second after a change
  await app.close();
  ({ app, page } = await launch());
  await page.click('[data-testid="wave-play"]');
  await page.waitForFunction(() => !window.__wave.audio.paused, null, { timeout: 30000 });
  const state = () => page.evaluate(() => {
    const s = window.__wave.usePlayer.getState();
    return { index: s.index, queue: s.queue.length, source: s.source?.kind };
  });
  const start = await state();
  for (let i = 0; i < 5; i++) {
    const before = (await state()).index;
    await page.click('[data-testid="next"]');
    await page.waitForFunction((b) => window.__wave.usePlayer.getState().index > b, before, { timeout: 20000 }).catch(async () => {
      throw new Error(`next ${i + 1} did not advance: ${JSON.stringify(await state())}, at the start ${JSON.stringify(start)}`);
    });
  }
  // The wave tops itself up ahead of what plays.
  await page.waitForFunction(() => {
    const s = window.__wave.usePlayer.getState();
    return s.queue.length - s.index - 1 >= 1;
  }, null, { timeout: 20000 }).catch(() => {});
  const end = await state();
  if (end.source !== 'wave' || end.queue - end.index - 1 < 1) throw new Error(`after five skips: ${JSON.stringify(end)}, at the start ${JSON.stringify(start)}`);
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('after a restart quick skips do not stall: the wave fills up as Oni opens', async () => {
  // The user: after a restart, three or four quick skips and then "next" did nothing until the
  // wave had fetched more. It tops up as soon as Oni is open now, and keeps more ahead.
  // A load the last step left under way may cut this play off (AbortError) — Oni ignores that too.
  await page.evaluate(() => window.__wave.audio.play().catch(() => {}));
  await page.waitForTimeout(1500);
  await app.close();
  ({ app, page } = await launch());
  const ahead = () => page.evaluate(() => {
    const s = window.__wave.usePlayer.getState();
    return { index: s.index, queue: s.queue.length, ahead: s.queue.length - s.index - 1, source: s.source?.kind };
  });
  await page.waitForFunction(() => {
    const s = window.__wave.usePlayer.getState();
    return s.source?.kind === 'wave' && s.queue.length - s.index - 1 >= 4;
  }, null, { timeout: 20000 }).catch(async () => {
    throw new Error(`no top-up before play: ${JSON.stringify(await ahead())}`);
  });
  await page.click('[data-testid="wave-play"]');
  await page.waitForFunction(() => !window.__wave.audio.paused, null, { timeout: 30000 });
  const start = await ahead();
  for (let i = 0; i < 4; i++) {
    await page.click('[data-testid="next"]');
    await page.waitForTimeout(150);
  }
  await page.waitForFunction((want) => window.__wave.usePlayer.getState().index >= want, start.index + 4, { timeout: 5000 }).catch(async () => {
    throw new Error(`four quick skips stalled: ${JSON.stringify(await ahead())}, at the start ${JSON.stringify(start)}`);
  });
  // The last of them loaded and playing before the pause (a load still under way would cut off
  // the next step's play).
  await page.waitForFunction(() => !window.__wave.usePlayer.getState().loading && !window.__wave.audio.paused, null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('mini player: remote for the main window in the tray', async () => {
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
  if (await mainShown()) throw new Error('main window should be in the tray');
  await mini.click('[data-testid="mini-toggle"]');
  await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 5000 });
  const closed = new Promise((r) => mini.once('close', r));
  // the click closes this very window, so don't wait on it afterwards
  await mini.click('[data-testid="mini-expand"]', { noWaitAfter: true }).catch(() => {});
  await closed;
  await page.waitForTimeout(500);
  if (!(await mainShown())) throw new Error('main window should come back');
});

await step('start with Windows: a login item that opens Oni in the tray (reverted)', async () => {
  // The user's wish. The switch registers a login item with --hidden; started so, the window
  // stays in the tray, the tray icon there to open it.
  const login = () => app.evaluate(({ app }) => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin);
  try {
    await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
    await page.locator('label', { has: page.locator('[data-testid="autostart"]') }).click();
    await page.waitForTimeout(300);
    if (!(await login())) throw new Error('no login item after switching it on');
    await page.locator('label', { has: page.locator('[data-testid="autostart"]') }).click();
    await page.waitForTimeout(300);
    if (await login()) throw new Error('the login item stayed after switching it off');
  } finally {
    await app.evaluate(({ app }) => app.setLoginItemSettings({ args: ['--hidden'], openAtLogin: false }));
  }
  await app.close();
  const hidden = await electron.launch({ args: [root, '--hidden'], cwd: root, env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData } });
  try {
    const hp = await hidden.firstWindow();
    await hp.waitForSelector('.wave-hero', { timeout: 30000 });
    await hp.waitForTimeout(800);
    const visible = await win(hidden, (w) => w.isVisible());
    const tray = await hidden.evaluate((_e, file) => process.mainModule.require(file).hasTray(), shellModule);
    if (visible) throw new Error('the window showed on a start with Windows');
    if (!tray) throw new Error('no tray icon to open it');
  } finally {
    await hidden.close();
  }
  ({ app, page } = await launch());
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

// ------------------------------------------------------------- Discord status
// A stand-in for Discord's desktop app on a pipe of its own (electron/discord.cjs takes its name
// from ONI_DISCORD_PIPE): the handshake is answered READY, each command is kept.
const pipe = `\\\\?\\pipe\\oni-test-discord-${process.pid}-`;
const got = [];
const discord = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  const send = (op, msg) => {
    const json = Buffer.from(JSON.stringify(msg));
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(json.length, 4);
    sock.write(Buffer.concat([head, json]));
  };
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      const msg = JSON.parse(buf.subarray(8, 8 + len).toString());
      buf = buf.subarray(8 + len);
      got.push({ op, msg });
      if (op === 0) send(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } });
      else send(1, { cmd: msg.cmd, nonce: msg.nonce, evt: null, data: {} });
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => discord.listen(pipe + '0', r));
await app.close().catch(() => {});
({ app, page } = await launch({ ONI_DISCORD_PIPE: pipe }));
const activities = () => got.filter((f) => f.op === 1 && f.msg.cmd === 'SET_ACTIVITY').map((f) => f.msg.args.activity ?? null);
const until = async (what, ms, why) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (what()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${why}: ${JSON.stringify(got.slice(-3))}`);
};

await step('Discord status: Oni introduces itself, and the track playing shows (listening, artists, time, cover)', async () => {
  const title = await page.evaluate(async () => {
    const chart = (await window.__wave.api.chart()).filter((t) => t.available !== false).slice(0, 2);
    await window.__wave.playTracks(chart, 0, 'e2e discord');
    return chart[0].title;
  });
  await until(() => got.some((f) => f.op === 0), 15000, 'no handshake');
  const hello = got.find((f) => f.op === 0).msg;
  if (hello.client_id !== '1562889548793516082' || hello.v !== 1) throw new Error(`handshake ${JSON.stringify(hello)}`);
  await until(() => activities().some((a) => a?.details?.startsWith(title)), 20000, 'no activity for the track');
  const a = activities().filter(Boolean).pop();
  if (a.type !== 2 || !a.state || !(a.timestamps?.end > a.timestamps?.start) || !a.assets?.large_image?.startsWith('http') || !a.buttons?.[0]?.url?.includes('music.yandex.ru')) throw new Error(`activity ${JSON.stringify(a)}`);
});

await step('Discord status: gone on a pause; the switch in Settings turns it off and on again', async () => {
  await page.evaluate(() => window.__wave.audio.pause());
  await until(() => activities().at(-1) === null, 8000, 'still shown on a pause');
  await page.evaluate(() => window.__wave.audio.play());
  await until(() => activities().at(-1) !== null, 8000, 'not back on play');
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  await page.locator('[data-testid="discord"]').uncheck();
  await until(() => activities().at(-1) === null, 8000, 'still shown when turned off');
  const n = activities().length;
  await page.evaluate(() => window.__wave.audio.pause());
  await page.evaluate(() => window.__wave.audio.play());
  await page.waitForTimeout(3000);
  if (activities().length !== n) throw new Error('sent while off');
  await page.locator('[data-testid="discord"]').check();
  await until(() => activities().at(-1) !== null, 20000, 'not back when turned on');
  await page.evaluate(() => window.__wave.audio.pause());
});

await app.close().catch(() => {});
discord.close();
fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
