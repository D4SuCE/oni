// e2e: now playing (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { app, page, step, shot } from './harness.mjs';

await step('now playing screen', async () => {
  await page.click('.pb-cover');
  await page.waitForSelector('.nowplaying');
  await page.waitForTimeout(1200);
  await shot('04-now-playing');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
});

await step('Now Playing has the volume under play, as on the iPhone: it moves the volume and fits the smallest window', async () => {
  // The user, 3.11.2026: "you have to leave the card to turn it down".
  const win = await app.browserWindow(page);
  const size = await win.evaluate((w) => w.getSize());
  const before = await page.evaluate(() => window.__wave.usePlayer.getState().volume);
  try {
    await page.evaluate(async () => {
      if (window.__wave.usePlayer.getState().queue.length) return;
      const r = await window.__wave.api.search('Rammstein Du hast', 'track');
      await window.__wave.playTracks(r.tracks.results.slice(0, 1), 0, 'e2e volume');
      window.__wave.audio.pause();
    });
    await page.click('.pb-cover');
    await page.waitForSelector('.nowplaying');
    const slider = page.locator('.nowplaying .np-volume input[type="range"]');
    await slider.waitFor({ timeout: 5000 });
    const box = await slider.boundingBox();
    // Near the left end of the line: quiet, and the player's volume follows the mouse.
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
    const quiet = await page.evaluate(() => window.__wave.usePlayer.getState().volume);
    if (!(quiet > 0.1 && quiet < 0.3)) throw new Error(`clicked at 20%, the volume is ${quiet}`);
    // The event itself: the mouse's own wheel does not reach the page on GitHub's machines (e2e.yml).
    await slider.evaluate((el) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })));
    await page.waitForFunction((q) => window.__wave.usePlayer.getState().volume > q, quiet, { timeout: 2000 });
    // In the smallest window (electron/main.cjs) all of the column is on screen, nothing on top of anything;
    // at every size, the phone's rules too, the line is a little shorter than the seek line, right under its middle.
    for (const [w, h, phone] of [[960, 620], [1320, 840], [1920, 1040], [390, 844, true]]) {
      await win.evaluate((x, [a, b, small]) => {
        if (small) x.setMinimumSize(390, 600);
        x.setSize(a, b);
      }, [w, h, phone]);
      await page.evaluate((on) => document.documentElement.classList.toggle('ios', on), Boolean(phone));
      await page.waitForTimeout(400);
      const fit = await page.evaluate(() => {
        const rect = (s) => document.querySelector(`.nowplaying ${s}`).getBoundingClientRect();
        const parts = ['.np-cover', '.np-meta', '.np-seek', '.transport', '.np-volume'].map((s) => [s, rect(s)]);
        // 30px: the same room below as the queue's column leaves, not pressed against the window's edge.
        const out = parts.filter(([, r]) => r.top < 0 || r.bottom > innerHeight - 30).map(([s]) => s);
        const over = parts.slice(1).filter(([, r], i) => r.top < parts[i][1].bottom - 1).map(([s]) => s);
        const close = rect('.np-close');
        const middle = (r) => r.left + r.width / 2;
        const seek = rect('.np-seek input[type="range"]');
        const volume = rect('.np-volume input[type="range"]');
        const icon = rect('.np-volume button');
        return {
          out,
          over,
          underClose: parts[0][1].top < close.bottom && parts[0][1].left < close.right,
          shorter: volume.width < seek.width && volume.width > seek.width * 0.6,
          off: [seek, rect('.play-btn'), parts[0][1]].map((r) => Math.round(Math.abs(middle(volume) - middle(r)))),
          beside: icon.right <= volume.left + 1 && volume.left - icon.right < 10,
          line: [Math.round(volume.width), Math.round(seek.width)],
          cover: parts[0][1].width,
        };
      });
      const placed = fit.shorter && fit.beside && fit.off.every((x) => x <= 1);
      if (!placed || (!phone && (fit.out.length || fit.over.length || fit.underClose))) throw new Error(`${w}×${h}: ${JSON.stringify(fit)}`);
      await shot(`04-now-playing-${h}`);
      console.log(`       ${w}×${h}: the cover ${Math.round(fit.cover)}px, volume ${fit.line[0]}px in the middle under a ${fit.line[1]}px seek line`);
    }
  } finally {
    await page.evaluate(() => document.documentElement.classList.remove('ios'));
    await win.evaluate((x) => x.setMinimumSize(960, 620));
    await win.evaluate((x, [a, b]) => x.setSize(a, b), size);
    await page.evaluate((v) => window.__wave.setVolume(v), before);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nowplaying', { state: 'detached' }).catch(() => {});
  }
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
    // The line sung now fills as it is sung: its bright part grows (clicked on, a line plays from its start).
    await page.locator('.np-side .lyric').nth(3).click();
    await page.evaluate(() => window.__wave.audio.play());
    const sung = () => page.evaluate(() => document.querySelector('.np-side .lyric.active .sung')?.textContent?.length ?? -1);
    await page.waitForFunction(() => (document.querySelector('.np-side .lyric.active .sung')?.textContent?.length ?? 0) > 0, null, { timeout: 15000 });
    const early = await sung();
    await page.waitForTimeout(500);
    const later = await sung();
    await page.evaluate(() => window.__wave.audio.pause());
    if (!(later > early)) throw new Error(`the line does not fill: ${early} → ${later} letters`);
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
