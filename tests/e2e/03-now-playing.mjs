// e2e: now playing (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, step, shot } from './harness.mjs';

await step('now playing screen', async () => {
  await page.click('.pb-cover');
  await page.waitForSelector('.nowplaying');
  await page.waitForTimeout(1200);
  await shot('04-now-playing');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
});

await step('a track Yandex has no lyrics for gets them from LRCLIB, saying so; "Wrong lyrics" takes them away and Genius is offered', async () => {
  // The user, 24.10.2026: lyrics not only from Yandex (LRCLIB; Genius only as a button). A track of
  // Yandex's with its lyrics flags taken off stands for one Yandex has none for.
  const id = await page.evaluate(async () => {
    const r = await window.__wave.api.search('Rammstein Du hast', 'track');
    const t = r.tracks?.results?.find((x) => x.available !== false && /^du hast$/i.test(x.title) && (x.durationMs ?? 0) > 200000);
    if (!t) return null;
    const bare = { ...t, lyricsInfo: { hasAvailableSyncLyrics: false, hasAvailableTextLyrics: false } };
    await window.__wave.playTracks([bare], 0, 'e2e lyrics');
    window.__wave.audio.pause();
    return String(t.id);
  });
  if (!id) throw new Error('"Du hast" not found on Yandex');
  try {
    await page.click('.pb-cover');
    await page.waitForSelector('.nowplaying');
    await page.click('[data-testid="tab-lyrics"]');
    const source = page.locator('[data-testid="lyrics-source"]');
    await source.waitFor({ timeout: 20000 });
    const lines = await page.locator('.np-side .lyric').count();
    if (!/LRCLIB/.test(await source.innerText()) || lines < 5) throw new Error(`source "${await source.innerText()}", ${lines} synced lines`);
    await page.click('[data-testid="lyrics-wrong"]');
    await page.waitForSelector('[data-testid="lyrics-genius"]', { timeout: 5000 });
    if (await page.locator('.np-side .lyric').count()) throw new Error('the wrong lyrics still show');
    console.log(`       ${lines} synced lines from LRCLIB; taken away, Genius offered`);
  } finally {
    // Not left marked wrong, nor kept, for the user's own Oni (a test run has its own storage anyway).
    await page.evaluate((i) => {
      const all = JSON.parse(window.__wave.storage.getItem('lyrics.v1') || '{}');
      delete all[i];
      window.__wave.storage.setItem('lyrics.v1', JSON.stringify(all));
    }, id);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nowplaying', { state: 'detached' });
  }
});

await step('an upload Yandex has found in the catalog: its artist is a link, its menu has the radio and the artist (read only)', async () => {
  // The user, 24.10.2026: "for my track there is neither the artist nor anything similar". Read only.
  const found = await page.evaluate(async () => {
    const me = String(await window.__wave.api.uid());
    for (const p of window.__wave.useApp.getState().playlists.filter((x) => String(x.owner?.uid) === me)) {
      const full = await window.__wave.api.playlist(p.uid, p.kind);
      const it = full.tracks?.find((x) => x.track?.trackSource === 'UGC' && x.track.matchedTrack?.id && x.track.available !== false);
      if (it) return { uid: p.uid, kind: p.kind, id: String(it.track.id), matched: String(it.track.matchedTrack.id) };
    }
    return null;
  });
  if (!found) {
    console.log('       skipped: no upload of the account found by Yandex');
    return;
  }
  await page.evaluate(({ uid, kind }) => window.__wave.navigate({ name: 'playlist', uid, kind }), found);
  const row = page.locator(`.track-row[data-track-id="${found.id}"]`).first();
  await row.waitFor({ timeout: 20000 });
  if (!(await row.locator('a.link').count())) throw new Error('the artist is no link');
  await row.click({ button: 'right' });
  await page.waitForSelector('.menu');
  const items = (await page.locator('.menu .menu-item .menu-label').allInnerTexts()).map((x) => x.trim());
  await page.keyboard.press('Escape');
  for (const want of ['Радио по треку', 'Перейти к исполнителю', 'Изменить']) if (!items.includes(want)) throw new Error(`menu: ${items.join(' | ')}`);
  console.log(`       upload ${found.id} found as ${found.matched}: ${items.length} menu items`);
});

await step('"keep mine offline" would keep On Repeat and the latest 30 likes not downloaded yet, each once', async () => {
  // The user's pick, 24.10.2026. Nothing is downloaded here (that is offline.download's, tested apart): what would be.
  await page.waitForFunction(() => window.__wave.useApp.getState().libraryReady, null, { timeout: 30000 });
  const plan = await page.evaluate(async () => {
    const tracks = await window.__wave.ownToKeep();
    const ids = tracks.map((t) => String(t.id));
    const latest = window.__wave.useApp.getState().likedKeys.slice(0, 30).map((k) => k.split(':')[0]).filter((id) => !window.__wave.offline.has(id));
    return { n: ids.length, unique: new Set(ids).size, downloaded: ids.filter((id) => window.__wave.offline.has(id)).length, latestIn: latest.filter((id) => ids.includes(id)).length, latest: latest.length };
  });
  if (!plan.n || plan.unique !== plan.n || plan.downloaded || plan.n > 30 + 50) throw new Error(JSON.stringify(plan));
  // The latest likes that play (a few may not) are among them.
  if (plan.latestIn < plan.latest - 5) throw new Error(`latest likes: ${plan.latestIn} of ${plan.latest}`);
  console.log(`       ${plan.n} tracks to keep (${plan.latestIn} of the latest likes)`);
});
