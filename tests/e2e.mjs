// End-to-end UI test: launches the real Electron app against the real API,
// clicks through the main screens, verifies audio actually plays, saves screenshots.
// Muted, isolated user-data dir, and wave feedback disabled (WAVE_E2E=1).
// Run: npm run test:e2e   (needs YANDEX_MUSIC_TOKEN)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const shots = process.env.WAVE_SHOTS || path.join(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-'));

let passed = 0;
let failed = 0;
const consoleErrors = [];

const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData },
});
const page = await app.firstWindow();
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.message || e}`);
    await page.screenshot({ path: path.join(shots, `FAIL-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  }
}
const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
const player = () => page.evaluate(() => {
  const s = window.__wave.usePlayer.getState();
  const a = window.__wave.audio;
  return { title: s.queue[s.index]?.title, index: s.index, queue: s.queue.length, source: s.source?.kind, playing: !a.paused, time: a.currentTime, stats: s.waveStats, error: s.error };
});
async function waitPlaying(minTime = 1.5, timeout = 30000) {
  await page.waitForFunction((t) => !window.__wave.audio.paused && window.__wave.audio.currentTime > t, minTime, { timeout });
}

await step('app starts and logs in with token', async () => {
  await page.waitForSelector('[data-testid="nav-home"]', { timeout: 30000 });
  await page.waitForSelector('.wave-hero');
  await page.waitForTimeout(2500); // let shelves & covers load
  await shot('01-home');
});

await step('wave plays real audio', async () => {
  await page.click('[data-testid="wave-play"]');
  await waitPlaying();
  const p = await player();
  if (p.source !== 'wave') throw new Error(`source=${p.source}`);
  console.log(`       playing: ${p.title} (queue ${p.queue})`);
  await page.waitForTimeout(1500);
  await shot('02-wave-playing');
});

await step('next track in wave', async () => {
  const before = await player();
  await page.click('[data-testid="next"]');
  await page.waitForFunction((i) => window.__wave.usePlayer.getState().index > i, before.index, { timeout: 20000 });
  await waitPlaying(0.5);
  const after = await player();
  if (after.title === before.title && after.index === before.index) throw new Error('did not advance');
  console.log(`       now: ${after.title}; stats: received ${after.stats?.received}, given ${after.stats?.given}`);
});

await step('pause / resume', async () => {
  await page.click('[data-testid="play-toggle"]');
  await page.waitForFunction(() => window.__wave.audio.paused);
  await page.click('[data-testid="play-toggle"]');
  await page.waitForFunction(() => !window.__wave.audio.paused);
});

await step('wave tuning panel', async () => {
  await page.click('[data-testid="wave-tune"]');
  await page.waitForSelector('.drawer');
  await page.waitForTimeout(800);
  await shot('03-wave-tuning');
  // Change a local filter and a Yandex-side setting; playback must keep going.
  await page.locator('.segmented').nth(0).locator('button', { hasText: 'Незнакомое' }).click();
  await page.waitForTimeout(2500);
  const p = await player();
  if (!p.playing) throw new Error('playback stopped after retune');
  if (p.queue - p.index - 1 < 1) throw new Error('no upcoming tracks after retune');
  await page.keyboard.press('Escape');
  await page.mouse.click(200, 400);
  await page.waitForSelector('.drawer', { state: 'detached' });
});

await step('now playing screen', async () => {
  await page.click('.pb-cover');
  await page.waitForSelector('.nowplaying');
  await page.waitForTimeout(1200);
  await shot('04-now-playing');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
});

await step('search and play a track', async () => {
  await page.click('[data-testid="nav-search"]');
  await page.fill('[data-testid="search-input"]', 'Кино');
  await page.waitForSelector('.track-row', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot('05-search');
  const first = page.locator('.track-row').first();
  await first.hover();
  await first.locator('.tr-play').click();
  await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.kind === 'list');
  await waitPlaying(0.5);
  console.log(`       playing: ${(await player()).title}`);
});

await step('track context menu + add-to-playlist submenu', async () => {
  const row = page.locator('.track-row').nth(1);
  await row.click({ button: 'right' });
  await page.waitForSelector('.menu');
  await page.locator('.menu-item', { hasText: 'Добавить в плейлист' }).hover();
  await page.waitForTimeout(300);
  if ((await page.locator('.menu').count()) < 2) throw new Error('submenu missing');
  await shot('06-context-menu');
  await page.keyboard.press('Escape');
});

await step('open album from search', async () => {
  await page.locator('.section', { hasText: 'Альбомы' }).locator('.card').first().click();
  await page.waitForSelector('.page-header');
  await page.waitForSelector('.track-row');
  await page.waitForTimeout(1200);
  await shot('07-album');
});

await step('open artist page', async () => {
  await page.locator('.page-meta .link').first().click();
  await page.waitForSelector('.page-header .cover.round', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot('08-artist');
});

await step('artist radio and similar tracks', async () => {
  await page.click('[data-testid="radio"]');
  await page.waitForFunction(
    () => {
      const s = window.__wave.usePlayer.getState();
      return s.source?.station?.seed?.startsWith('artist:') && s.index >= 0 && !s.loading && !window.__wave.audio.paused;
    },
    null,
    { timeout: 30000 },
  );
  const label = await page.locator('.pb-source').innerText();
  if (!label.includes('Радио')) throw new Error(`source label "${label}"`);
  await page.click('.pb-cover');
  await page.click('[data-testid="tab-similar"]');
  await page.waitForSelector('.similar .track-row, .np-side .muted', { timeout: 15000 });
  console.log(`       ${label}; similar: ${await page.locator('.similar .track-row').count()}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
});

await step('back navigation', async () => {
  await page.click('.sidebar-top .icon-btn');
  await page.waitForSelector('.page-header .page-cover:not(.round)');
});

await step('like then unlike (reverted)', async () => {
  const row = page.locator('.track-row').first();
  const id = await row.getAttribute('data-track-id');
  const was = await page.evaluate((id) => window.__wave.useApp.getState().liked.has(id), id);
  await row.hover();
  await row.locator('.tr-like').click();
  await page.waitForFunction(([id, was]) => window.__wave.useApp.getState().liked.has(id) !== was, [id, was]);
  await page.waitForTimeout(800);
  await row.locator('.tr-like').click();
  await page.waitForFunction(([id, was]) => window.__wave.useApp.getState().liked.has(id) === was, [id, was]);
  await page.waitForTimeout(800);
});

await step('liked tracks page', async () => {
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('.track-row, .empty-hint', { timeout: 20000 });
  // Library and Liked used to open the same page and both lit up.
  if ((await page.locator('.sidebar .nav-item.active').count()) !== 1) throw new Error('more than one nav item is active');
  await page.waitForTimeout(1500);
  await shot('09-liked');
});

await step('library: own and liked playlists', async () => {
  await page.click('[data-testid="nav-library"]');
  await page.waitForSelector('[data-testid="liked-card"]');
  const expected = await page.evaluate(() => window.__wave.useApp.getState().likedPlaylists.length);
  const shown = await page.locator('[data-testid="liked-playlists"] .card').count();
  if (shown !== expected) throw new Error(`liked playlists: shown ${shown}, expected ${expected}`);
  console.log(`       liked playlists: ${shown}`);
  await page.waitForTimeout(800);
  await shot('10-playlists');
});

await step('like then unlike a playlist (reverted)', async () => {
  // Someone else's playlist from search that is not liked yet.
  const target = await page.evaluate(async () => {
    const s = window.__wave.useApp.getState();
    const r = await window.__wave.api.search('Кино');
    const mine = String(s.account.uid);
    return (r.playlists?.results || []).find((p) => String(p.uid) !== mine && !s.likedPlaylists.some((l) => String(l.uid) === String(p.uid) && String(l.kind) === String(p.kind)));
  });
  if (!target) throw new Error('no playlist to try');
  await page.evaluate((p) => window.__wave.navigate({ name: 'playlist', uid: p.uid, kind: p.kind }), target);
  const btn = page.locator('[data-testid="playlist-like"]');
  const onServer = async () => (await page.evaluate(() => window.__wave.api.likedPlaylists())).some((p) => String(p.uid) === String(target.uid) && String(p.kind) === String(target.kind));
  // Yandex's like list catches up with a write after a moment, so poll instead of reading once.
  const serverBecomes = async (liked) => {
    for (let i = 0; i < 16; i++) {
      if ((await onServer()) === liked) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
  try {
    await btn.click();
    await page.waitForSelector('[data-testid="playlist-like"].on');
    if (!(await serverBecomes(true))) throw new Error('like did not reach Yandex');
    await btn.click();
    await page.waitForSelector('[data-testid="playlist-like"]:not(.on)');
    if (!(await serverBecomes(false))) throw new Error('unlike did not reach Yandex');
  } finally {
    // Never leave the test's like on the real account, even if the like shows up late.
    if (!(await serverBecomes(false))) await page.evaluate((p) => window.__wave.api.setPlaylistLiked(p, false), target);
  }
});

await step('settings page', async () => {
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  await page.waitForSelector('.panel');
  await shot('11-settings');
});

await step('keyboard: space toggles playback', async () => {
  await page.mouse.click(700, 300);
  const before = await page.evaluate(() => window.__wave.audio.paused);
  await page.keyboard.press('Space');
  await page.waitForFunction((b) => window.__wave.audio.paused !== b, before);
  await page.keyboard.press('Space');
  await page.waitForFunction((b) => window.__wave.audio.paused === b, before);
});

await step('narrow (phone) layout renders', async () => {
  const win = await app.browserWindow(page);
  await win.evaluate((w) => {
    w.setMinimumSize(390, 600);
    w.setSize(390, 844);
  });
  await page.waitForTimeout(800);
  await page.click('[data-testid="nav-home"]');
  await page.waitForTimeout(1200);
  await shot('12-phone-home');
  await win.evaluate((w) => w.setSize(1320, 840));
});

await step('english interface has no Russian left', async () => {
  // Only the app's own chrome: titles, tabs, buttons, tooltips. Yandex data stays as it is.
  const CHROME = [
    '.nav > .nav-item', '.nav-section > span', '.page-title', '.section-head h2', '.tabs .tab', '.kicker',
    '.wave-hero h1', '.wave-hero .btn', '.panel h3', '.panel .hint', '.empty-hint', '.pb-empty', '.lib-actions .btn',
  ].join(',');
  const leftovers = async () =>
    page.evaluate((sel) => {
      const texts = [...document.querySelectorAll(sel)].map((el) => el.textContent);
      const titles = [...document.querySelectorAll('button[title], [aria-label]')]
        .filter((el) => !el.closest('.nav-playlists, .track-row, .q-row, .card'))
        .map((el) => el.getAttribute('title') || el.getAttribute('aria-label'));
      return [...texts, ...titles].filter((t) => /[А-Яа-яЁё]/.test(t || ''));
    }, CHROME);
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  await page.locator('.segmented button', { hasText: 'English' }).click();
  const found = [];
  for (const [nav, ready] of [
    ['settings', '.panel'],
    ['home', '.wave-hero'],
    ['search', '[data-testid="search-input"]'],
    ['library', '[data-testid="liked-card"]'],
    ['liked', '.track-row, .empty-hint'],
  ]) {
    if (nav !== 'settings') await page.click(`[data-testid="nav-${nav}"]`);
    await page.waitForSelector(ready);
    await page.waitForTimeout(600);
    found.push(...(await leftovers()).map((t) => `${nav}: ${t}`));
  }
  await page.locator('.sidebar > .nav-item', { hasText: 'Settings' }).click();
  await page.locator('.segmented button', { hasText: 'Русский' }).click();
  if (found.length) throw new Error(`untranslated: ${[...new Set(found)].slice(0, 8).join(' | ')}`);
});

await step('no console errors', async () => {
  const relevant = consoleErrors.filter((e) => !/favicon|Autofill/i.test(e));
  if (relevant.length) throw new Error(relevant.slice(0, 5).join('\n'));
});

// Runs after the console check on purpose: it produces errors deliberately.
await step('a crashing page keeps the shell alive', async () => {
  await page.click('[data-testid="nav-library"]');
  await page.locator('.tabs.big .tab', { hasText: 'Плейлисты' }).click();
  await page.waitForSelector('.grid .card');
  // Someone else's playlist is drawn only on this page (the sidebar lists own ones),
  // and an object title is a guaranteed render error.
  await page.evaluate(() => {
    const s = window.__wave.useApp.getState();
    window.__playlistsBackup = s.playlists;
    window.__wave.useApp.setState({ playlists: [...s.playlists, { uid: -1, kind: -1, title: {}, trackCount: 0 }] });
  });
  await page.waitForSelector('.crash-card.inline', { timeout: 5000 });
  if (!(await page.locator('[data-testid="nav-search"]').isVisible())) throw new Error('sidebar is gone');
  await page.evaluate(() => window.__wave.useApp.setState({ playlists: window.__playlistsBackup }));
  await page.locator('.crash-card .btn.primary').click();
  await page.waitForSelector('.grid .card', { timeout: 5000 });
});

await page.evaluate(() => window.__wave.audio.pause());
await app.close();
fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${shots}`);
if (failed) process.exit(1);
