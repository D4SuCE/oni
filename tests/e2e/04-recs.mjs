// e2e: recs (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, step, shot, waitPlaying } from './harness.mjs';

await step('daylist leads "For you" and fits the time of day', async () => {
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('[data-testid="for-you"] [data-testid="mix-card"]', { timeout: 60000 });
  const first = page.locator('[data-testid="for-you"] [data-testid="mix-card"]').first();
  const seal = await first.locator('.mix-seal').innerText();
  const h = new Date().getHours();
  const want = h >= 1 && h < 5 ? '深夜' : h >= 5 && h < 11 ? '朝' : h >= 11 && h < 17 ? '昼' : h >= 17 && h < 21 ? '夕' : '夜';
  if (seal !== want) throw new Error(`first card seal "${seal}", want "${want}" at ${h}:00`);
  await first.click();
  await page.waitForSelector('.track-row');
  const kicker = await page.locator('.kicker').first().innerText();
  const rows = await page.locator('.track-row').count();
  const meta = await page.locator('.page-meta').innerText();
  if (!/daylist/i.test(kicker) || rows < 10 || !/до \d{1,2}:\d{2}/.test(meta)) throw new Error(`kicker "${kicker}", ${rows} tracks, meta "${meta}"`);
  await shot('15-daylist');
  await page.click('[data-testid="mix-play"]');
  await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.origin === 'daylist', null, { timeout: 10000 });
  await waitPlaying(0.5);
  await page.click('[data-testid="nav-home"]');
});

await step('hide a track from the mixes, then bring it back from Settings ("Skipped": the list, one back alone)', async () => {
  await page.locator('[data-testid="for-you"] [data-testid="mix-card"]').first().click();
  await page.waitForSelector('.track-row');
  const row = page.locator('.track-row').first();
  // By its id: rows off screen are drawn lazily (content-visibility), their text empty until then.
  const id = await row.getAttribute('data-track-id');
  // The title's own text: an explicit track's badge ("Explicit", "E") is in the same element.
  const title = await row.locator('.tr-title').evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim());
  const before = await page.locator('.track-row').count();
  await row.click({ button: 'right' });
  await page.getByText('Скрыть из подборок', { exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.track-row').length === n - 1, before, { timeout: 5000 });
  if (await page.locator(`.track-row[data-track-id="${id}"]`).count()) throw new Error(`track ${id} is still in the mix`);
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  const note = await page.locator('[data-testid="mix-feedback"]').innerText();
  if (!/Пропущенное: \d/.test(note)) throw new Error(`settings: ${note}`);
  await page.click('[data-testid="skipped-toggle"]');
  const listed = page.locator('[data-testid="skipped-row"]', { hasText: 'скрыт вами' }).filter({ hasText: title });
  if ((await listed.count()) !== 1) throw new Error(`"${title}" not in the list: ${await page.locator('[data-testid="skipped-list"]').innerText()}`);
  await listed.locator('[data-testid="skipped-back"]').click();
  await listed.waitFor({ state: 'detached', timeout: 3000 });
  await page.click('[data-testid="nav-home"]');
  await page.locator('[data-testid="for-you"] [data-testid="mix-card"]').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('.track-row').length === n, before, { timeout: 5000 });
  await page.click('[data-testid="nav-home"]');
});

await step('an artist left out of the mixes is listed in Settings by name and comes back alone (no track skipped needed)', async () => {
  // The user, 25.10.2026: the phone showed "… and 16 more" with nothing to open (no track was skipped there).
  await page.evaluate(() => {
    const t = { id: 'e2e-demoted', title: 'e2e', artists: [{ id: 'e2e-artist', name: 'E2E Artist' }], albums: [] };
    window.__wave.recsFeedback.recordPlay(t, 'skipped', Date.now());
    window.__wave.recsFeedback.recordPlay(t, 'skipped', Date.now());
  });
  try {
    await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
    await page.click('[data-testid="skipped-toggle"]');
    const row = page.locator('[data-testid="demoted-row"]', { hasText: 'E2E Artist' });
    await row.waitFor({ timeout: 3000 });
    if (!/до /.test(await row.innerText())) throw new Error(`row: ${await row.innerText()}`);
    await row.locator('[data-testid="demoted-back"]').click();
    await row.waitFor({ state: 'detached', timeout: 3000 });
    if (await page.evaluate(() => window.__wave.recsFeedback.isDemoted('e2e-artist', Date.now()))) throw new Error('still demoted');
  } finally {
    await page.evaluate(() => window.__wave.recsFeedback.liftArtist('e2e-artist'));
    await page.click('[data-testid="nav-home"]');
  }
});

await step('smart playlists: a section of their own on Home; "Liked this month" is the last 30 days of likes, plays as itself, and a new like is in it at once (reverted)', async () => {
  await page.click('[data-testid="nav-home"]');
  const section = page.locator('[data-testid="smart-playlists"]');
  await section.waitFor({ timeout: 60000 });
  const titles = await section.locator('.card-title').allInnerTexts();
  const month = section.locator('[data-testid="mix-card"]', { hasText: 'Лайки за месяц' });
  if (!(await month.count())) throw new Error(`cards: ${titles.join(', ')}`);
  console.log(`       ${titles.join(', ')}`);
  // What Yandex has: the likes of the last 30 days that play.
  const want = await page.evaluate(async () => {
    const w = window.__wave;
    const dates = (await w.api.likedTrackDates()).filter((d) => Date.now() - d.at <= 30 * 86_400_000);
    const tracks = await w.api.tracks(dates.map((d) => d.key));
    return tracks.filter((t) => t.available !== false).length;
  });
  await month.click();
  await page.waitForSelector('.track-row');
  // A long list is drawn in parts: on GitHub's slower machine 40 of 83 rows were counted (28.10.2026).
  await page.waitForFunction((n) => document.querySelectorAll('.track-row').length >= n - 1, want, { timeout: 15000 }).catch(() => {});
  const kicker = await page.locator('.kicker').first().innerText();
  const meta = await page.locator('.page-meta').innerText();
  const rows = await page.locator('.track-row').count();
  if (!/умный плейлист/i.test(kicker) || !/30 дней/.test(meta) || /треков · \d+ треков/.test(meta) || Math.abs(rows - want) > 1) throw new Error(`kicker "${kicker}", meta "${meta}", ${rows} rows, ${want} liked this month`);
  if ((await page.locator('.mix-seal').first().innerText()) !== '今月') throw new Error('seal');
  await shot('16-smart-playlist');
  await page.click('[data-testid="mix-play"]');
  await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.origin === 'auto', null, { timeout: 10000 });
  const source = await page.evaluate(() => window.__wave.usePlayer.getState().source?.title);
  if (source !== 'Лайки за месяц') throw new Error(`playing from "${source}"`);
  await page.evaluate(() => window.__wave.audio.pause());
  // A like: it is at the top at once (the likes changed, the lists made of them are built again).
  const liked = await page.evaluate(async () => {
    const w = window.__wave;
    const t = (await w.api.chart()).find((x) => x.available !== false && !w.useApp.getState().liked.has(String(x.id)));
    if (!t) return null;
    await w.toggleLike(t);
    return t;
  });
  if (!liked) throw new Error('no chart track left to like');
  try {
    await page.click('[data-testid="nav-home"]');
    await page.waitForFunction((id) => window.__wave.findMix?.('auto-likedMonth')?.tracks[0]?.id == id, liked.id, { timeout: 30000 });
  } finally {
    await page.evaluate(async (t) => {
      if (window.__wave.useApp.getState().liked.has(String(t.id))) await window.__wave.toggleLike(t);
    }, liked);
  }
});
