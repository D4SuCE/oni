// e2e: wave (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, step, shot, player, waitPlaying } from './harness.mjs';

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
  // Found by the user (both platforms): the first Yandex-side pick after My Wave started only
  // changed the banner's label, the track played on; the second pick did switch it. The wave
  // must restart with the very first pick, and keep going.
  const before = await player();
  try {
    await page.locator('.segmented').nth(0).locator('button', { hasText: 'Незнакомое' }).click();
    await page.waitForFunction((t) => {
      const s = window.__wave.usePlayer.getState();
      return s.tuning.diversity === 'discover' && !s.waveBusy && s.queue[s.index]?.title !== t && !window.__wave.audio.paused;
    }, before.title, { timeout: 25000 }).catch(async (e) => {
      throw new Error(`the first pick did not restart the wave: ${JSON.stringify(await player())} (${e.message})`);
    });
    await page.waitForTimeout(2500);
    const p = await player();
    if (!p.playing) throw new Error('playback stopped after retune');
    if (p.queue - p.index - 1 < 1) throw new Error('no upcoming tracks after retune');
  } finally {
    await page.evaluate(() => window.__wave.usePlayer.setState((s) => ({ tuning: { ...s.tuning, diversity: 'default' } })));
    await page.keyboard.press('Escape');
    if (await page.locator('.drawer').count()) await page.mouse.click(200, 400);
    await page.waitForSelector('.drawer', { state: 'detached' });
  }
});

await step('a Yandex-side tuning while a list plays starts the wave with it, and next works', async () => {
  // Found by the user: an activity picked in "Tune" while a track played left that track on,
  // and "next" did nothing after it.
  await page.evaluate(async () => {
    const chart = await window.__wave.api.chart();
    await window.__wave.playTracks(chart.slice(0, 3), 0, 'e2e');
  });
  await waitPlaying(0.5);
  const before = await player();
  let started;
  let picked;
  try {
    await page.click('[data-testid="wave-tune"]');
    await page.waitForSelector('.drawer .chips .chip:nth-child(2)', { timeout: 15000 });
    picked = await page.locator('.drawer .chips .chip').nth(1).innerText();
    await page.locator('.drawer .chips .chip').nth(1).click();
    await page.waitForFunction((t) => {
      const s = window.__wave.usePlayer.getState();
      return s.source?.kind === 'wave' && !s.waveBusy && s.queue[s.index]?.title !== t;
    }, before.title, { timeout: 25000 });
    await waitPlaying(0.5);
    started = await player();
  } finally {
    // Closed whatever happened: left open, it covers the page and every later step fails.
    await page.keyboard.press('Escape');
    if (await page.locator('.drawer').count()) await page.mouse.click(200, 400);
    await page.waitForSelector('.drawer', { state: 'detached' });
  }
  await page.click('[data-testid="next"]');
  await page.waitForFunction((i) => window.__wave.usePlayer.getState().index > i, started.index, { timeout: 20000 }).catch(async (e) => {
    throw new Error(`next did not advance: ${JSON.stringify(await player())} (${e.message})`);
  });
  await waitPlaying(0.5);
  console.log(`       "${picked}": ${before.title} -> ${started.title} -> ${(await player()).title}`);
  // History names the wave with what was picked (the user, 25.10.2026: not "My Wave" alone).
  await waitPlaying(6, 30000);
  await page.click('[data-testid="nav-history"]');
  await page.click('[data-testid="history-app"]');
  const run = await page.locator('.history-group .history-context > span').first().innerText();
  await page.click('[data-testid="nav-home"]');
  if (run.toLowerCase() !== `Моя волна · ${picked}`.toLowerCase()) throw new Error(`History: "${run}", picked "${picked}"`);
  // Back to the default wave, as the run found it.
  await page.evaluate(() => window.__wave.usePlayer.setState((s) => ({ tuning: { ...s.tuning, context: null } })));
});

await step('a list played after a tuned My Wave clears its picks in "Tune"; a pick there, even "Any", starts My Wave', async () => {
  // Found by the user: My Wave set to "sad", then "Listen" in Recap — the recap played, but
  // "Tune" still showed "sad" picked, as if My Wave were playing with it.
  await page.evaluate(() => window.__wave.usePlayer.setState((s) => ({ tuning: { ...s.tuning, mood: 'sad' } })));
  await page.evaluate(async () => {
    const chart = await window.__wave.api.chart();
    await window.__wave.playTracks(chart.slice(0, 3), 0, 'e2e');
  });
  await waitPlaying(0.5);
  const tuning = () => page.evaluate(() => window.__wave.usePlayer.getState().tuning);
  const after = await tuning();
  if (after.mood !== 'all') throw new Error(`the list left the wave's picks: ${JSON.stringify(after)}`);
  const before = await player();
  try {
    await page.click('[data-testid="nav-home"]');
    await page.click('[data-testid="wave-tune"]');
    await page.waitForSelector('.drawer .segmented');
    const mood = page.locator('.drawer .segmented').nth(1).locator('button');
    const active = await mood.evaluateAll((bs) => bs.findIndex((b) => b.classList.contains('active')));
    if (active !== 0) throw new Error(`"Tune" shows mood #${active} picked, not "Any"`);
    await mood.nth(0).click(); // "Любое": what is shown already, yet a pick of My Wave
    await page.waitForFunction((t) => {
      const s = window.__wave.usePlayer.getState();
      return s.source?.kind === 'wave' && !s.source.station && !s.waveBusy && s.queue[s.index]?.title !== t && !window.__wave.audio.paused;
    }, before.title, { timeout: 30000 }).catch(async (e) => {
      throw new Error(`My Wave did not start: ${JSON.stringify(await player())} (${e.message})`);
    });
    console.log(`       list ${before.title} -> "Any" -> My Wave: ${(await player()).title}`);
  } finally {
    await page.evaluate(() => window.__wave.usePlayer.setState((s) => ({ tuning: { ...s.tuning, mood: 'all' } })));
    await page.keyboard.press('Escape');
    if (await page.locator('.drawer').count()) await page.mouse.click(200, 400);
    await page.waitForSelector('.drawer', { state: 'detached' });
  }
});

await step('settings picked during a track radio start My Wave with them: quick picks in several sections, the last wins; a slow one switches again', async () => {
  // Found by the user on the phone: picking "sad" left the old track on, and picking back too.
  // During a station radio the setting did nothing at all.
  await page.evaluate(async () => {
    const chart = await window.__wave.api.chart();
    window.__wave.usePlayer.setState({ queue: [chart[0]], index: 0 });
  });
  await page.click('[data-testid="now-more"]');
  await page.locator('.menu-item', { hasText: 'Радио по треку' }).click();
  await page.waitForFunction(() => {
    const s = window.__wave.usePlayer.getState();
    return s.source?.station && !s.waveBusy && !window.__wave.audio.paused;
  }, null, { timeout: 30000 });
  const before = await player();
  try {
    await page.click('[data-testid="nav-home"]');
    await page.click('[data-testid="wave-tune"]');
    await page.waitForSelector('.drawer .segmented');
    const section = (n) => page.locator('.drawer .segmented').nth(n).locator('button');
    // Several sections, quickly: each pick restarts the wave, and only the last start, with all
    // of them, may play.
    await section(1).nth(4).click(); // mood "Грустное"
    await page.waitForTimeout(150);
    await section(1).nth(1).click(); // mood "Бодрое", before the first could finish
    await page.waitForTimeout(150);
    await section(2).nth(2).click(); // language "Иностранный"
    await page.waitForTimeout(150);
    await section(0).nth(2).click(); // character "Незнакомое"
    const tuning = () => page.evaluate(() => window.__wave.usePlayer.getState().tuning);
    await page.waitForFunction((t) => {
      const s = window.__wave.usePlayer.getState();
      const all = s.tuning.mood === 'active' && s.tuning.language === 'not-russian' && s.tuning.diversity === 'discover';
      return all && s.source?.kind === 'wave' && !s.source.station && !s.waveBusy && s.queue[s.index]?.title !== t && !window.__wave.audio.paused;
    }, before.title, { timeout: 30000 }).catch(async (e) => {
      throw new Error(`${JSON.stringify(await player())}, tuning ${JSON.stringify(await tuning())} (${e.message})`);
    });
    // And slowly: one more pick after the wave has settled switches the track again.
    const settled = await player();
    await section(1).nth(3).click(); // mood "Спокойное"
    await page.waitForFunction((t) => {
      const s = window.__wave.usePlayer.getState();
      return s.tuning.mood === 'calm' && !s.waveBusy && s.queue[s.index]?.title !== t && !window.__wave.audio.paused;
    }, settled.title, { timeout: 30000 });
    console.log(`       radio: ${before.title} -> My Wave (active, foreign, new): ${settled.title} -> calm: ${(await player()).title}`);
  } finally {
    await page.evaluate(() => window.__wave.usePlayer.setState((s) => ({ tuning: { ...s.tuning, mood: 'all', language: 'any', diversity: 'default' } })));
    await page.keyboard.press('Escape');
    if (await page.locator('.drawer').count()) await page.mouse.click(200, 400);
    await page.waitForSelector('.drawer', { state: 'detached' });
  }
});

await step('a held seek bar shows the time it goes to in its left label, lit; let go, the playing time again', async () => {
  // Asked by the user: seeking along the bar, there was no telling what time it would go to; the
  // left label (the playing time) says it while the bar is held.
  await page.evaluate(async () => {
    const chart = await window.__wave.api.chart();
    await window.__wave.playTracks(chart.slice(0, 2), 0, 'e2e');
  });
  await waitPlaying(0.5);
  await page.evaluate(() => window.__wave.audio.pause());
  const bar = page.locator('.playerbar .seek .range');
  const label = page.locator('.playerbar [data-testid="seek-time"]');
  const box = await bar.boundingBox();
  const duration = await page.evaluate(() => window.__wave.usePlayer.getState().duration);
  const secs = (text) => text.split(':').reduce((a, b) => a * 60 + Number(b), 0);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, y, { steps: 6 });
  const held = secs(await label.innerText());
  const lit = await label.evaluate((el) => el.classList.contains('seeking'));
  await page.mouse.up();
  if (Math.abs(held - duration * 0.75) > duration * 0.03 + 1 || !lit) throw new Error(`held at 75%: label ${held} s (lit ${lit}), want ~${Math.round(duration * 0.75)}`);
  await page.waitForFunction(() => !document.querySelector('.playerbar [data-testid="seek-time"]').classList.contains('seeking'), null, { timeout: 3000 });
  const position = await page.evaluate(() => window.__wave.audio.currentTime);
  if (Math.abs(position - duration * 0.75) > duration * 0.03 + 1) throw new Error(`let go: playing at ${position.toFixed(1)} s`);
  console.log(`       ${Math.round(duration)} s: held at 75% -> label ${held} s, then playing at ${position.toFixed(0)} s`);
});

await step('a playback error shows as a toast that goes away by itself', async () => {
  // Found by the user: "Couldn't play …" stayed over the player for good.
  await page.evaluate(() => window.__wave.usePlayer.setState({ error: 'e2e: could not play' }));
  await page.waitForSelector('.toast:has-text("e2e: could not play")', { timeout: 3000 });
  await page.waitForSelector('.toast:has-text("e2e: could not play")', { state: 'detached', timeout: 6000 });
  // At the top, out of the player's way, and a click puts it away at once (the user's wish).
  await page.evaluate(() => window.__wave.usePlayer.setState({ error: 'e2e: tap me away' }));
  const toast = page.locator('[data-testid="toast"]');
  await toast.waitFor({ timeout: 3000 });
  const box = await toast.boundingBox();
  if (box.y > 120) throw new Error(`the toast is at y=${box.y}, not at the top`);
  await toast.click();
  await page.waitForSelector('[data-testid="toast"]', { state: 'detached', timeout: 1000 });
});

await step('"…" pressed again closes its menu instead of opening it anew', async () => {
  const open = () => page.locator('.menu').count();
  await page.click('[data-testid="now-more"]');
  await page.waitForSelector('.menu');
  await page.click('[data-testid="now-more"]');
  await page.waitForTimeout(300);
  if (await open()) throw new Error('a second press left a menu open');
  await page.waitForTimeout(500);
  await page.click('[data-testid="now-more"]');
  await page.waitForSelector('.menu', { timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu', { state: 'detached' });
});

await step('sleep timer: after this track it stops at its end; in minutes it fades out and pauses', async () => {
  // The user's wish (accepted proposals). Wave playing from the steps above.
  await page.evaluate(() => window.__wave.audio.play());
  await waitPlaying(0.5);
  const before = await player();
  await page.click('.playerbar [data-testid="sleep"]');
  await page.locator('.menu-item', { hasText: 'После этого трека' }).click();
  if (!(await page.evaluate(() => window.__wave.usePlayer.getState().sleep.afterTrack))) throw new Error('not set');
  await page.evaluate(() => (window.__wave.audio.currentTime = window.__wave.audio.duration - 1.5));
  await page.waitForFunction(() => window.__wave.audio.paused && !window.__wave.usePlayer.getState().sleep.afterTrack, null, { timeout: 15000 });
  const after = await player();
  if (after.index !== before.index) throw new Error(`went on to the next track: ${before.index} -> ${after.index}`);
  // In minutes (a few seconds here): faded out, paused, the volume back for next time.
  await page.click('[data-testid="next"]');
  await waitPlaying(0.5);
  const volume = await page.evaluate(() => window.__wave.audio.volume);
  await page.evaluate(() => window.__wave.setSleep(0.05));
  await page.waitForSelector('.playerbar [data-testid="sleep"] .sleep-left', { timeout: 2000 });
  await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 15000 });
  const back = await page.evaluate(() => window.__wave.audio.volume);
  if (Math.abs(back - volume) > 0.01) throw new Error(`volume ${volume} -> ${back} after the fade`);
  if (await page.locator('.playerbar [data-testid="sleep"] .sleep-left').count()) throw new Error('the timer still shows');
});

await step('volume levelling: a loud track turned down, a quiet one raised while its peak stays clean, an album in order at one level (shuffled: each its own)', async () => {
  // The user, 25.10.2026: like Apple's Sound Check, only the track's overall level. Two chart
  // tracks stand in, their loudness data set here.
  const r = await page.evaluate(async () => {
    const w = window.__wave;
    const chart = await w.api.chart();
    const [a, b] = chart.filter((t) => t.available !== false).slice(0, 2);
    const at = async (tracks, from) => {
      await w.playTracks(tracks, 0, 'e2e levelling', from);
      w.audio.pause();
      await new Promise((r) => setTimeout(r, 300));
      return { el: w.audio.volume / w.usePlayer.getState().volume, lift: w.levelLift() };
    };
    const quiet = { ...a, r128: { i: -20, tp: -6 }, durationMs: 60_000 };
    const loud = { ...b, r128: { i: -5, tp: 1 }, durationMs: 240_000 };
    const res = { loud: await at([loud]), quiet: await at([quiet]), clipping: await at([{ ...a, r128: { i: -20, tp: -0.5 } }]) };
    // An album (−8.9 LUFS as one, its peak −0.5): the quiet intro keeps the album's level.
    const album = [quiet, { ...loud, r128: { i: -8, tp: -0.5 } }];
    res.album = await at(album, { album: a.albums?.[0]?.id ?? 1 });
    w.toggleShuffle();
    await new Promise((r) => setTimeout(r, 300));
    res.shuffled = { lift: w.levelLift(), shuffle: w.usePlayer.getState().shuffle };
    if (w.usePlayer.getState().shuffle) w.toggleShuffle();
    return res;
  });
  const near = (x, y) => Math.abs(x - y) < 0.01;
  if (!near(r.loud.el, 10 ** (-3 / 20)) || r.loud.lift !== 1) throw new Error(`loud: ${JSON.stringify(r)}`);
  // −20 LUFS, peak −6: 5 dB of room under −1 dBTP (the target is 12 dB away).
  if (!near(r.quiet.el, 1) || !near(r.quiet.lift, 10 ** (5 / 20))) throw new Error(`quiet: ${JSON.stringify(r)}`);
  if (!near(r.clipping.el, 1) || r.clipping.lift !== 1) throw new Error(`raised into clipping: ${JSON.stringify(r)}`);
  if (!near(r.album.el, 1) || r.album.lift !== 1) throw new Error(`album: ${JSON.stringify(r)}`);
  if (!r.shuffled.shuffle || !near(r.shuffled.lift, 10 ** (5 / 20))) throw new Error(`shuffled album: ${JSON.stringify(r)}`);
});

await step('«Своя волна»: a button beside "Tune" starts Oni\'s own station from the account\'s music; it plays, says so, and a pick of its share ("New") starts it anew with a new track', async () => {
  await page.click('[data-testid="nav-home"]');
  await page.click('[data-testid="own-wave"]');
  await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.station?.seed === 'oni:own', null, { timeout: 15000 });
  await waitPlaying(1, 60000);
  await page.waitForFunction(() => { const s = window.__wave.usePlayer.getState(); return s.queue.length - s.index > 2; }, null, { timeout: 30000 });
  const kicker = await page.locator('[data-testid="wave-kicker"]').textContent();
  const bar = await page.locator('.pb-source-text').innerText();
  if (kicker !== 'Своя волна' || !/Своя волна/.test(bar)) throw new Error(`kicker "${kicker}", bar "${bar}"`);
  if (await page.locator('[data-testid="own-wave"]').count()) throw new Error('the button is still offered while it plays');
  // Next: the station goes on (and an early skip teaches it).
  const first = await page.evaluate(() => String(window.__wave.current()?.id));
  await page.click('[data-testid="next"]');
  await page.waitForFunction((id) => String(window.__wave.current()?.id) !== id && !window.__wave.audio.paused, first, { timeout: 30000 });
  // "New": the station starts anew with it, a new track at once (the user, 26.10.2026: picking a
  // mode looked as if nothing happened); back to "Balanced".
  const playing = await page.evaluate(() => String(window.__wave.current()?.id));
  await page.click('[data-testid="wave-tune"]');
  await page.locator('[data-testid="own-modes"] .segmented button', { hasText: 'Новое' }).click();
  await page.waitForFunction((was) => { const s = window.__wave.usePlayer.getState(); return s.ownMode === 'fresh' && s.source?.station?.seed === 'oni:own' && String(window.__wave.current()?.id) !== was && !window.__wave.audio.paused; }, playing, { timeout: 30000 });
  await page.locator('[data-testid="own-modes"] .segmented button', { hasText: 'Поровну' }).click();
  await page.waitForFunction(() => window.__wave.usePlayer.getState().ownMode === 'balanced' && !window.__wave.usePlayer.getState().waveBusy, null, { timeout: 30000 });
  await page.keyboard.press('Escape');
  await page.locator('.drawer-backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await shot('17-own-wave');
  console.log(`       ${await page.evaluate(() => window.__wave.usePlayer.getState().queue.slice(0, 5).map((t) => t.title).join(' · '))}`);
});
