// Downloads and the offline mode, in the real app: a track downloaded from the track menu is
// stored encrypted and plays from the file; the network lost during My Wave plays the downloads
// until it is back; started with no network (the main process fails every request,
// WAVE_E2E_OFFLINE=1), the app opens on Liked, kept from the last look, where the downloaded
// tracks play in its order, and so does a playlist; when the network is back, it goes online
// again. Needs YANDEX_MUSIC_TOKEN like e2e.mjs.
// Run: npm run test:e2e (runs after login.mjs)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-offline-'));
const offlineDir = path.join(userData, 'offline');
const shots = path.join(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
let passed = 0;
let failed = 0;

async function launch(offline = false) {
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData, ...(offline ? { WAVE_E2E_OFFLINE: '1' } : {}) },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(offline ? '[data-testid="offline-banner"]' : '.wave-hero', { timeout: 30000 });
  return { app, page };
}

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

const state = (page) => page.evaluate(() => {
  const s = window.__wave.usePlayer.getState();
  return JSON.stringify({ source: s.source, index: s.index, queue: s.queue.length, busy: s.waveBusy, paused: window.__wave.audio.paused, src: window.__wave.audio.src.slice(0, 30), offline: window.__wave.useApp.getState().offline });
});
const explain = (page, what) => async (e) => {
  throw new Error(`${what}: ${await state(page)} (${e.message.split('\n')[0]})`);
};

async function playingFromFile(page) {
  await page.waitForFunction(() => window.__wave.audio.src.startsWith('blob:') && !window.__wave.audio.paused && window.__wave.audio.currentTime > 1, null, { timeout: 20000 });
  // The bar moves with it.
  await page.waitForFunction(() => document.querySelector('.playerbar .time')?.textContent !== '0:00', null, { timeout: 5000 });
}

let { app, page } = await launch();
let title = '';

await step('download a track: encrypted on disk, then it plays from the file', async () => {
  await page.waitForSelector('[data-testid="mix-card"]', { timeout: 60000 });
  await page.locator('[data-testid="mix-card"]').first().click();
  const row = page.locator('.track-row').first();
  await row.waitFor();
  title = await row.locator('.tr-title').innerText();
  await row.click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Скачать' }).click();
  await row.locator('[data-testid="saved-mark"]').waitFor({ timeout: 60000 });

  // The track, encrypted, and its cover beside it.
  await page.waitForFunction(() => window.__wave.offline.entries()[0]?.cover, null, { timeout: 15000 });
  const files = fs.readdirSync(offlineDir).sort();
  if (files.length !== 2 || !files[0].endsWith('.jpg') || !files[1].endsWith('.oni')) throw new Error(`files: ${files}`);
  const head = fs.readFileSync(path.join(offlineDir, files[1])).subarray(0, 4096);
  // Not an mp3 anyone can open: no ID3 tag, no MPEG frame sync at the start.
  if (head.includes(Buffer.from('ID3')) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) throw new Error('the file on disk is plain audio');

  await row.locator('.tr-play').click();
  await playingFromFile(page);
  await shot(page, '20-downloaded-mark');
});

await step('the downloads page lists it', async () => {
  await page.click('[data-testid="nav-downloads"]');
  await page.waitForSelector('.track-row');
  const titles = await page.locator('.track-row .tr-title').allInnerTexts();
  if (titles.length !== 1 || titles[0] !== title) throw new Error(`downloads: ${titles}`);
  await shot(page, '21-downloads');
});

/** Ids of Liked's 2nd and 4th tracks and of a playlist's 2nd, downloaded; both pages seen online. */
let likedIds = [];
let likedTotal = 0;
let playlist = null;

await step('downloaded tracks of Liked and of a playlist: both lists are kept when seen', async () => {
  likedIds = await page.evaluate(async () => {
    const keys = window.__wave.useApp.getState().likedKeys;
    const tracks = await window.__wave.api.tracks(keys.slice(0, 6));
    const picked = [tracks[1], tracks[3]];
    for (const t of picked) await window.__wave.offline.download(t);
    return picked.map((t) => String(t.id));
  });
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('[data-testid="saved-mark"]', { timeout: 30000 });
  likedTotal = await page.evaluate(() => window.__wave.useApp.getState().likedKeys.length);
  await page.waitForFunction((n) => document.querySelectorAll('.track-row').length >= n, likedTotal, { timeout: 30000 });
  playlist = await page.evaluate(async () => {
    const own = window.__wave.useApp.getState().playlists.find((p) => p.trackCount >= 3);
    const pl = await window.__wave.api.playlist(own.uid, own.kind);
    const t = pl.tracks.map((x) => x.track).filter((x) => x && x.available !== false)[1];
    await window.__wave.offline.download(t);
    window.__wave.navigate({ name: 'playlist', uid: own.uid, kind: own.kind });
    return { uid: own.uid, kind: own.kind, id: String(t.id), title: pl.title };
  });
  await page.waitForSelector('[data-testid="saved-mark"]', { timeout: 30000 });
  await page.waitForTimeout(500);
  const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem('offline.lists.v1') || '{}')[key]?.tracks.length, `playlist:${playlist.uid}:${playlist.kind}`);
  if (!kept) throw new Error('the playlist was not kept');
});

await step('the network lost during My Wave: the downloads play, and the wave comes back with the network', async () => {
  // The user's wish, as in Yandex's app.
  await page.click('[data-testid="nav-home"]');
  // A list's track is up: the banner's "My Wave" link starts the wave (its Play would resume that).
  await page.click('[data-testid="wave-back"]');
  await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.kind === 'wave' && !window.__wave.audio.paused, null, { timeout: 30000 }).catch(explain(page, 'the wave did not start'));
  await page.evaluate(() => {
    window.wave.setNetworkForTest(false);
    window.dispatchEvent(new Event('offline'));
  });
  await page.waitForSelector('[data-testid="offline-banner"]', { timeout: 5000 });
  // Nothing left in the wave's queue: the downloads take over instead of a stop.
  await page.evaluate(() => window.__wave.usePlayer.setState((s) => ({ queue: s.queue.slice(0, s.index + 1) })));
  await page.click('[data-testid="next"]');
  await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.list === 'downloads', null, { timeout: 15000 }).catch(explain(page, 'no downloads'));
  await playingFromFile(page);
  const queue = await page.evaluate(() => window.__wave.usePlayer.getState().queue.length);
  if (queue !== 4) throw new Error(`the downloads queue has ${queue} tracks, 4 are downloaded`);
  await page.evaluate(() => {
    window.wave.setNetworkForTest(true);
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForSelector('[data-testid="offline-banner"]', { state: 'detached', timeout: 15000 });
  // The downloaded track plays to its end; then (here: next) the wave again.
  if ((await page.evaluate(() => window.__wave.usePlayer.getState().source?.kind)) !== 'list') throw new Error('the track was cut off when the network came back');
  await page.click('[data-testid="next"]');
  await page.waitForFunction(() => {
    const s = window.__wave.usePlayer.getState();
    return s.source?.kind === 'wave' && !s.source.station && !s.waveBusy && !window.__wave.audio.paused;
  }, null, { timeout: 30000 }).catch(explain(page, 'the wave did not come back'));
  await page.evaluate(() => window.__wave.audio.pause());
});

await app.close();
({ app, page } = await launch(true));

await step('no network: the app starts on Liked, kept whole; the downloaded tracks play in its order', async () => {
  await page.waitForSelector('[data-testid="list-play"]', { timeout: 10000 });
  const rows = await page.locator('.track-row').count();
  const off = await page.locator('.track-row.unavailable').count();
  if (rows < likedTotal || off !== rows - 2) throw new Error(`${rows} rows (Liked has ${likedTotal}), ${off} dimmed`);
  await page.click('[data-testid="list-play"]');
  await playingFromFile(page);
  const queue = await page.evaluate(() => window.__wave.usePlayer.getState().queue.map((t) => String(t.id)));
  if (queue.join() !== likedIds.join()) throw new Error(`queue ${queue}, want ${likedIds}`);
  // Their covers show though nothing loads from the network (the user: the picture was missing).
  await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`.track-row[data-track-id="${id}"] img`)?.src.startsWith('blob:')), likedIds, { timeout: 5000 }).catch(async () => {
    throw new Error(`covers: ${await page.evaluate((ids) => ids.map((id) => document.querySelector(`.track-row[data-track-id="${id}"] img`)?.src ?? 'none').join(', '), likedIds)}`);
  });
  await shot(page, '22-offline');
});

await step('no network: a playlist with a downloaded track opens and plays it', async () => {
  await page.evaluate(({ uid, kind }) => window.__wave.navigate({ name: 'playlist', uid, kind }), playlist);
  await page.waitForSelector('[data-testid="list-play"]', { timeout: 10000 });
  if (!(await page.locator('h1', { hasText: playlist.title }).count())) throw new Error('no playlist title');
  await page.click('[data-testid="list-play"]');
  await playingFromFile(page);
  const queue = await page.evaluate(() => window.__wave.usePlayer.getState().queue.map((t) => String(t.id)));
  if (queue.join() !== playlist.id) throw new Error(`queue ${queue}, want ${playlist.id}`);
});

await step('no network: Downloads lists everything downloaded', async () => {
  await page.click('[data-testid="nav-downloads"]');
  await page.waitForSelector('.track-row');
  const titles = await page.locator('.track-row .tr-title').allInnerTexts();
  if (titles.length !== 4 || !titles.includes(title)) throw new Error(`downloads offline: ${titles}`);
});

await step('the network is back: the app goes online again', async () => {
  await page.evaluate(() => {
    window.wave.setNetworkForTest(true);
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForSelector('[data-testid="offline-banner"]', { state: 'detached', timeout: 15000 });
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('.wave-hero', { timeout: 15000 });
});

await step('remove all from Settings frees the space', async () => {
  await page.click('[data-testid="nav-settings"]');
  await page.click('[data-testid="downloads-remove-all"]');
  await page.locator('.dialog button.danger').click();
  await page.waitForSelector('[data-testid="downloads-remove-all"]', { state: 'detached', timeout: 5000 });
  if (fs.readdirSync(offlineDir).length) throw new Error('files left');
});

await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
