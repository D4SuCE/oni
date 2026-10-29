// e2e: lists (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, page, SLOW, step, shot, waitPlaying } from './harness.mjs';

await step('search inside Liked: the list narrows, and a found track plays the whole list from it', async () => {
  // Its button at the right edge of the row of buttons (the user's wish, as on the iPhone).
  const edge = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.lib-actions > *')].map((b) => b.getBoundingClientRect().right);
    return document.querySelector('[data-testid="list-search"]').getBoundingClientRect().right >= Math.max(...row) - 1;
  });
  if (!edge) throw new Error('the search button is not at the right edge');
  const total = await page.locator('.track-row').count();
  // The title's own text: marks such as the explicit "E" are elements of their own, glued to it in innerText.
  const title = await page.locator('.track-row .tr-title').nth(2).evaluate((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
  const word = title.split(/\s+/).find((w) => w.length >= 3) ?? '';
  await page.click('[data-testid="list-search"]');
  await page.fill('[data-testid="list-search-input"]', word);
  await page.waitForTimeout(300);
  const rows = page.locator('.track-row');
  const shown = await rows.count();
  const texts = await rows.evaluateAll((els) => els.map((e) => e.textContent.toLowerCase()));
  if (!shown || shown >= total || !texts.every((x) => x.includes(word.toLowerCase()))) throw new Error(`"${word}": ${shown} of ${total}`);
  const id = await rows.first().getAttribute('data-track-id');
  await rows.first().dblclick();
  await page.waitForFunction((want) => String(window.__wave.usePlayer.getState().queue[window.__wave.usePlayer.getState().index]?.id) === want, id, { timeout: 15000 });
  const queue = await page.evaluate(() => window.__wave.usePlayer.getState().queue.length);
  if (queue < total) throw new Error(`queue ${queue}, list ${total}`);
  console.log(`       "${word}": ${shown} of ${total}`);
  // Escape closes the search (the user, 26.10.2026), the field no longer focused (a row played).
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="list-search-input"]', { state: 'detached', timeout: 3000 });
  if ((await rows.count()) !== total) throw new Error(`after Escape ${await rows.count()} of ${total}`);
});

await step('a playing list says so on its page: Play turns Pause, then Resume, without starting over', async () => {
  // The user: a playlist started from its page did not show there that it plays.
  const button = page.locator('[data-testid="list-play"]');
  const state = () => page.evaluate(() => {
    const s = window.__wave.usePlayer.getState();
    return { index: s.index, id: s.queue[s.index]?.id, paused: window.__wave.audio.paused };
  });
  const why = (what) => async (e) => {
    const info = await page.evaluate(() => {
      const s = window.__wave.usePlayer.getState();
      const b = document.querySelector('[data-testid="list-play"]');
      return { route: window.__wave.useApp.getState().route, source: s.source, playing: s.playing, paused: window.__wave.audio.paused, button: b ? `${b.textContent} ${b.dataset.playing ?? ''}` : 'none' };
    });
    throw new Error(`${what}: ${JSON.stringify(info)} (${e.message.split('\n')[0]})`);
  };
  // Liked plays already (the search step started it from a found track): its button is Pause.
  await page.waitForSelector('[data-testid="list-play"][data-playing]', { timeout: 10000 }).catch(why('Liked not shown playing'));
  if (!(await button.innerText()).includes('Пауза')) throw new Error(`label "${await button.innerText()}"`);
  const before = await state();
  await button.click();
  await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 10000 }).catch(why('Pause did not pause'));
  // The label follows the player's state a moment after the audio (read at once, it failed now and then).
  await page.waitForFunction(() => document.querySelector('[data-testid="list-play"]')?.textContent.includes('Продолжить'), null, { timeout: 5000 }).catch(async () => {
    throw new Error(`paused label "${await button.innerText()}"`);
  });
  await button.click();
  await page.waitForFunction(() => !window.__wave.audio.paused, null, { timeout: 15000 }).catch(why('Resume did not play'));
  const after = await state();
  if (after.id !== before.id || after.index !== before.index) throw new Error(`started over: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  // Another list's page offers Play as ever.
  await page.evaluate(async () => {
    const pl = (await window.__wave.api.playlists())[0];
    window.__wave.navigate({ name: 'playlist', uid: pl.uid, kind: pl.kind });
  });
  await page.waitForSelector('[data-testid="list-play"]', { timeout: 15000 }).catch(why('no Play on another playlist'));
  if (await page.locator('[data-testid="list-play"][data-playing]').count()) throw new Error('another playlist shows as playing');
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('[data-testid="list-play"][data-playing]', { timeout: 15000 }).catch(why('Liked not shown playing on return'));
});

await step('Pause pressed while the next track still loads keeps it from starting; Play then starts it', async () => {
  // Found by the e2e run (twice): the button said Pause while a track loaded, but the press went by
  // the audio, not playing yet, and started it. A pause on the lock screen right after "next" too.
  await page.evaluate(async () => {
    const chart = await window.__wave.api.chart();
    await window.__wave.playTracks(chart.slice(3, 6), 0, 'e2e');
  });
  await waitPlaying(0.5);
  // "Next", and Pause at once, while the next one loads.
  await page.evaluate(() => {
    document.querySelector('[data-testid="next"]').click();
    document.querySelector('[data-testid="play-toggle"]').click();
  });
  await page.waitForTimeout(4000);
  const held = await page.evaluate(() => ({ paused: window.__wave.audio.paused, playing: window.__wave.usePlayer.getState().playing, index: window.__wave.usePlayer.getState().index }));
  if (!held.paused || held.playing || held.index !== 1) throw new Error(`after Pause while loading: ${JSON.stringify(held)}`);
  await page.click('[data-testid="play-toggle"]');
  await waitPlaying(0.3, 15000).catch(() => {
    throw new Error('Play after that did not start the track');
  });
  const index = await page.evaluate(() => window.__wave.usePlayer.getState().index);
  if (index !== 1) throw new Error(`Play started track ${index}, not the loaded one`);
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('Liked opened again shows its Download button at once and the whole list a moment later, without the network', async () => {
  // The user: Download came up late on Liked (it waited for the rest of the list after the first
  // hundred). Seen once, the list is kept and shows right away; the fresh one replaces it quietly.
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('.wave-hero');
  const t0 = Date.now();
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('[data-testid="download-all"]', { timeout: 15000 });
  const ms = Date.now() - t0;
  const keys = await page.evaluate(() => window.__wave.useApp.getState().likedKeys.length);
  // The whole list is there without the network: its rows are drawn a moment after the first 40 (the
  // tab opens with them: the user, 25.10.2026), within a second, not after the fresh list comes in.
  await page.waitForFunction((n) => document.querySelectorAll('.track-row').length >= n, keys, { timeout: 1500 }).catch(() => {});
  const rows = await page.locator('.track-row').count();
  const whole = Date.now() - t0;
  console.log(`       Download after ${ms} ms, ${rows} of ${keys} rows after ${whole} ms`);
  if (ms > 500 || rows < keys) throw new Error(`Download after ${ms} ms, ${rows} of ${keys} rows after ${whole} ms`);
});

await step('a big playlist opens at once, the rest of it comes in parts and joins a queue started early', async () => {
  // The user: a friend's 1,600-track playlist took seconds to open. That one (pavel_hope's Liked,
  // saved by the user), or the account's own Liked as a playlist if it is gone.
  const big = await page.evaluate(() => {
    const s = window.__wave.useApp.getState();
    const theirs = s.likedPlaylists.find((p) => p.owner?.login === 'pavel_hope') ?? [...s.likedPlaylists].sort((a, b) => b.trackCount - a.trackCount)[0];
    return theirs && theirs.trackCount > 1000 ? { uid: theirs.uid, kind: theirs.kind, n: theirs.trackCount } : { uid: s.account.uid, kind: 3, n: s.likedKeys.length };
  });
  const t0 = Date.now();
  await page.evaluate(({ uid, kind }) => window.__wave.navigate({ name: 'playlist', uid, kind }), big);
  await page.waitForSelector('.track-row', { timeout: 15000 });
  const first = Date.now() - t0;
  const early = await page.locator('.track-row').count();
  // Started before the rest is in: the queue grows to the whole list as it comes.
  await page.locator('.track-row').first().locator('.tr-play').click();
  await page.waitForSelector('[data-testid="list-loading"]', { state: 'detached', timeout: 60000 });
  const all = Date.now() - t0;
  const rows = await page.locator('.track-row').count();
  const playable = await page.locator('.track-row:not(.unavailable)').count();
  await page.waitForFunction((n) => window.__wave.usePlayer.getState().queue.length >= n, playable, { timeout: 5000 }).catch(() => {});
  const queue = await page.evaluate(() => window.__wave.usePlayer.getState().queue.length);
  console.log(`       ${big.n} tracks: first ${early} rows after ${first} ms, all ${rows} after ${all} ms; queue ${queue} of ${playable} playable`);
  // Its search at the page's right edge, as on Liked (the user), not just after the last button.
  const gap = await page.evaluate(() => {
    const search = document.querySelector('[data-testid="list-search"]').getBoundingClientRect();
    return document.querySelector('.page-header').getBoundingClientRect().right - search.right;
  });
  if (gap > 2) throw new Error(`the search button is ${gap}px short of the right edge`);
  // The first part shows before the whole list is in (the old page waited for all of it).
  if (first > 2000 * SLOW || early >= rows) throw new Error(`the first rows took ${first} ms, ${early} of ${rows}`);
  if (rows < big.n * 0.9 || queue < playable) throw new Error(`${rows} rows, queue ${queue} of ${playable}`);
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('Liked has a radio, as playlists do', async () => {
  await page.click('[data-testid="radio"]');
  await page.waitForFunction(() => {
    const s = window.__wave.usePlayer.getState();
    return /^playlist:\d+:3$/.test(s.source?.station?.seed ?? '') && !s.waveBusy && !window.__wave.audio.paused;
  }, null, { timeout: 30000 });
  if (await page.locator('[data-testid="list-play"][data-playing]').count()) throw new Error('Liked still shows as playing during its radio');
});

await step("Liked saved as CSV: a line per track, Excel's mark, links to Yandex Music", async () => {
  // The save dialog is not shown here: the file goes to a folder of the test's own.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oni-csv-'));
  await page.click('[data-testid="nav-liked"]');
  await app.evaluate(({ session }, folder) => {
    session.defaultSession.removeAllListeners('will-download');
    session.defaultSession.on('will-download', (_e, item) => item.setSavePath(folder + item.getFilename()));
  }, dir + path.sep);
  try {
    await page.waitForSelector('[data-testid="export-csv"]', { timeout: 20000 });
    await page.click('[data-testid="export-csv"]');
    const file = await (async () => {
      for (let i = 0; i < 50; i++) {
        const found = fs.readdirSync(dir).find((f) => f.endsWith('.csv'));
        if (found && fs.statSync(path.join(dir, found)).size > 0) return path.join(dir, found);
        await page.waitForTimeout(200);
      }
      throw new Error('no file saved');
    })();
    await page.waitForTimeout(300);
    const text = fs.readFileSync(file, 'utf8');
    const count = await page.evaluate(() => window.__wave.useApp.getState().likedKeys.length);
    const lines = text.trim().split('\r\n');
    if (!text.startsWith('\ufeffTrack Name,Artist Name(s),')) throw new Error(`header: ${text.slice(0, 60)}`);
    if (lines.length - 1 !== count) throw new Error(`${lines.length - 1} lines for ${count} liked`);
    if (!lines.slice(1).every((l) => l.includes('https://music.yandex.ru/'))) throw new Error(`a line with no link: ${lines.find((l) => !l.includes('https://music.yandex.ru/'))}`);
    console.log(`       ${path.basename(file)}: ${count} tracks`);
  } finally {
    await app.evaluate(({ session }) => session.defaultSession.removeAllListeners('will-download'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await step('sidebar playlists are dragged into an order of one\'s own, which stays after a reload', async () => {
  // The user's wish (Windows). The account has a few playlists in the sidebar.
  const names = () => page.locator('[data-testid="nav-playlist"]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  const before = await names();
  if (before.length < 3) throw new Error(`only ${before.length} playlists in the sidebar`);
  try {
    const items = page.locator('[data-testid="nav-playlist"]');
    const target = await items.nth(2).boundingBox();
    // Onto the lower half of the third: it lands after it.
    await items.nth(0).dragTo(items.nth(2), { targetPosition: { x: 20, y: target.height - 4 } });
    const after = await names();
    const want = [before[1], before[2], before[0], ...before.slice(3)];
    if (after.join('|') !== want.join('|')) throw new Error(`after the drag: ${after.slice(0, 4).join(', ')}; want ${want.slice(0, 4).join(', ')}`);
    await page.reload();
    await page.waitForSelector('[data-testid="nav-playlist"]', { timeout: 30000 });
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="nav-playlist"]').length >= n, before.length, { timeout: 30000 });
    const reloaded = await names();
    if (reloaded.slice(0, 3).join('|') !== want.slice(0, 3).join('|')) throw new Error(`after a reload: ${reloaded.slice(0, 3).join(', ')}`);
  } finally {
    await page.evaluate(() => localStorage.removeItem('ui.sidebar.order'));
  }
});

await step('after a restart the restored track plays on the first Play', async () => {
  // The user: after reopening Oni, Play did nothing; only next/previous got it going.
  const state = () => page.evaluate(() => {
    const s = window.__wave.usePlayer.getState();
    const a = window.__wave.audio;
    return { index: s.index, id: s.queue[s.index]?.id, paused: a.paused, src: !!a.src, time: a.currentTime };
  });
  await page.reload();
  await page.waitForSelector('[data-testid="play-toggle"]', { timeout: 30000 });
  const before = await state();
  if (!before.id) throw new Error('no track restored');
  await page.click('[data-testid="play-toggle"]');
  // Not only "not paused": with no track in place the audio is unpaused too, and silent.
  await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.audio.currentTime > 0.5, null, { timeout: 15000 }).catch(async () => {
    throw new Error(`Play did not play: ${JSON.stringify(await state())}`);
  });
  const after = await state();
  if (after.id !== before.id) throw new Error(`another track: ${before.id} -> ${after.id}`);
});

/** Drags a row by the held left mouse button onto another's lower half (it lands after it). */
async function dragRow(from, onto, selector = '.track-row') {
  const rows = page.locator(selector);
  const a = await rows.nth(from).boundingBox();
  const b = await rows.nth(onto).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((b.y + b.height * 0.8 - (a.y + a.height / 2)) * k) / 8);
  await page.mouse.up();
}

await step('an own playlist: a track dragged by the held mouse button moves, also at Yandex (temporary playlist)', async () => {
  // The user's wish: own playlists in an order of one's own, on both platforms.
  const pl = await page.evaluate(async () => {
    const w = window.__wave;
    const created = await w.api.createPlaylist('oni-e2e-move');
    const chart = (await w.api.chart()).filter((t) => t.available !== false).slice(0, 3);
    await w.api.addToPlaylist(created, chart, 0);
    return { uid: created.uid, kind: created.kind };
  });
  try {
    const ids = () => page.locator('.track-row').evaluateAll((els) => els.map((e) => e.dataset.trackId));
    await page.evaluate(({ uid, kind }) => window.__wave.navigate({ name: 'playlist', uid, kind }), pl);
    await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 3, null, { timeout: 15000 });
    const before = await ids();
    await dragRow(0, 2);
    const want = [before[1], before[2], before[0]];
    await page.waitForFunction((w) => [...document.querySelectorAll('.track-row')].map((e) => e.dataset.trackId).join() === w.join(), want, { timeout: 5000 }).catch(async () => {
      throw new Error(`on the page: ${await ids()}; want ${want}`);
    });
    await page.waitForFunction(async ({ uid, kind, w }) => {
      const fresh = await window.__wave.api.playlist(uid, kind, false);
      return fresh.tracks.map((x) => String(x.id)).join() === w.join();
    }, { ...pl, w: want }, { timeout: 15000, polling: 1000 });
  } finally {
    await page.evaluate((kind) => window.__wave.api.deletePlaylist(kind), pl.kind);
  }
});

await step('Liked: a track dragged moves at Yandex too (one re-like call), then the order is put back', async () => {
  // The user: the order synced to the other devices. Yandex keeps likes newest first; liking
  // again puts tracks on top in the order given.
  await page.click('[data-testid="nav-liked"]');
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length >= window.__wave.useApp.getState().likedKeys.length, null, { timeout: 30000 });
  const before = await page.evaluate(async () => (await window.__wave.api.likedTrackKeys()).slice(0, 3));
  const id = (k) => k.split(':')[0];
  try {
    await dragRow(2, 0);
    await page.mouse.move(0, 0);
    // Onto the first row's lower half: it lands second.
    const want = [id(before[0]), id(before[2]), id(before[1])];
    await page.waitForFunction(async (w) => (await window.__wave.api.likedTrackKeys()).slice(0, 3).map((k) => k.split(':')[0]).join() === w.join(), want, { timeout: 15000, polling: 1000 }).catch(async () => {
      throw new Error(`at Yandex: ${(await page.evaluate(async () => (await window.__wave.api.likedTrackKeys()).slice(0, 3))).map(id)}; want ${want}`);
    });
  } finally {
    // The first three as they were (liked again in their order: the first on top).
    await page.evaluate((keys) => window.__wave.api.setLiked(keys, true), before);
  }
});

await step('the queue: an up-next track dragged moves in the queue', async () => {
  await page.evaluate(async () => {
    const chart = (await window.__wave.api.chart()).filter((t) => t.available !== false).slice(0, 5);
    await window.__wave.playTracks(chart, 0, 'e2e queue');
  });
  await waitPlaying(0.5);
  await page.click('.pb-cover');
  await page.waitForSelector('.nowplaying .q-row[data-sort-index]');
  const queue = () => page.evaluate(() => window.__wave.usePlayer.getState().queue.map((t) => String(t.id)));
  const before = await queue();
  await dragRow(0, 1, '.nowplaying .q-row[data-sort-index]');
  const after = await queue();
  const want = [before[0], before[2], before[1], ...before.slice(3)];
  if (after.join() !== want.join()) throw new Error(`queue ${after.slice(0, 4)}; want ${want.slice(0, 4)}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
  await page.evaluate(() => window.__wave.audio.pause());
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
