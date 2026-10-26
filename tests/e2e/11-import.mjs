// e2e: playlist import (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, step, shot } from './harness.mjs';

const NAME = 'Oni e2e import';

await step('import a pasted list: found tracks make a playlist in order, the one Yandex lacks waits (removed again)', async () => {
  // The user, 26.10.2026: playlists from other services, found in Yandex Music.
  await page.evaluate(() => window.__wave.navigate({ name: 'library', tab: 'playlists' }));
  await page.click('[data-testid="import-card"]');
  await page.fill('[data-testid="import-input"]', 'Кино — Группа крови\nDaft Punk — One More Time\nZzqxv Nobody — Qqqzzx Never Was (5:55)');
  await page.click('[data-testid="import-find"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="import-row"][data-state="pending"]') && document.querySelectorAll('[data-testid="import-row"]').length === 3, null, { timeout: 60000 });
  const states = await page.$$eval('[data-testid="import-row"]', (rows) => rows.map((r) => r.getAttribute('data-state')));
  if (states.join() !== 'found,found,none') throw new Error(`states ${states.join()}`);
  await shot('11-import-review');
  let pl = null;
  try {
    await page.fill('[data-testid="import-title"]', NAME);
    await page.click('[data-testid="import-create"]');
    await page.waitForSelector('[data-testid="import-done"]', { timeout: 30000 });
    pl = await page.evaluate(async (name) => {
      const { api } = window.__wave;
      const mine = await api.playlists();
      const found = mine.find((p) => p.title === name);
      return found && (await api.playlist(found.uid, found.kind));
    }, NAME);
    if (!pl) throw new Error('no playlist made');
    const titles = (pl.tracks ?? []).map((i) => i.track?.title);
    if (titles.length !== 2 || !/группа крови/i.test(titles[0]) || !/one more time/i.test(titles[1])) throw new Error(`tracks ${JSON.stringify(titles)}`);
    const waiting = await page.evaluate((kind) => JSON.parse(window.__wave.storage.getItem('import.waiting') || '[]').filter((w) => String(w.playlist.kind) === String(kind)).map((w) => w.src.title), pl.kind);
    if (waiting.join() !== 'Qqqzzx Never Was') throw new Error(`waiting ${JSON.stringify(waiting)}`);
    console.log(`       "${NAME}": ${titles.join(', ')}; waiting: ${waiting.join(', ')}`);
  } finally {
    await page.evaluate(async (name) => {
      const { api, storage } = window.__wave;
      for (const p of (await api.playlists()).filter((p) => p.title === name)) await api.deletePlaylist(p.kind);
      storage.setItem('import.waiting', JSON.stringify(JSON.parse(storage.getItem('import.waiting') || '[]').filter((w) => w.playlist.title !== name)));
    }, NAME);
  }
});

await step('import reads a Spotify link: its tracks are looked for (nothing made)', async () => {
  await page.evaluate(() => window.__wave.navigate({ name: 'library', tab: 'playlists' }));
  await page.click('[data-testid="import-card"]');
  await page.fill('[data-testid="import-input"]', 'https://open.spotify.com/playlist/37i9dQZF1DX5Ejj0EkURtP');
  await page.click('[data-testid="import-find"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="import-row"]').length >= 50 || document.querySelector('[data-testid="import-error"]'), null, { timeout: 30000 });
  const error = await page.$eval('[data-testid="import-error"]', (e) => e.textContent).catch(() => null);
  if (error) throw new Error(`the link was not read: ${error}`);
  // the first rows found (the rest is not waited for)
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="import-row"][data-state="found"]').length >= 5, null, { timeout: 60000 });
  const n = await page.$$eval('[data-testid="import-row"]', (rows) => rows.length);
  console.log(`       ${n} tracks read`);
  await page.evaluate(() => window.__wave.navigate({ name: 'home' }));
});
