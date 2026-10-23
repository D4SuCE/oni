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

/** GitHub's machines (e2e.yml) have no graphics card and are slower than the user's PC: the speed
 * checks get this much more room there; on the PC they stay as they are. */
const SLOW = process.env.CI ? 3 : 1;

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

await step('the oni mask sits in the middle of the logo', async () => {
  // The mask's axis is the nose line where the white half meets the black one: per row of the
  // nose, the sharpest light-to-dark step near the middle; its median must be the image centre.
  const { seam, width } = await page.evaluate(async () => {
    const url = getComputedStyle(document.querySelector('.logo-mark')).backgroundImage.slice(5, -2);
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const c = document.createElement('canvas');
    c.width = c.height = w;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, w).data;
    const lum = (x, y) => { const i = (y * w + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
    const step = Math.max(1, Math.round(w / 170));
    const seams = [];
    for (let y = Math.round(w * 0.51); y < w * 0.74; y++) {
      let best = 0, at = -1;
      for (let x = Math.round(w * 0.37); x < w * 0.63 - step; x++) {
        const g = lum(x, y) - lum(x + step, y);
        if (g > best) [best, at] = [g, x + step / 2];
      }
      if (best > 60) seams.push(at);
    }
    seams.sort((a, b) => a - b);
    return { seam: seams[seams.length >> 1], width: w };
  });
  if (!(Math.abs(seam - width / 2) <= width * 0.015)) throw new Error(`mask axis at ${seam} of ${width}`);
});

await step('button labels sit in the middle of the button', async () => {
  // Optical middle of a label: halfway between the x-height and cap-height middles above the
  // baseline. The baseline comes from an empty inline-block probe, the heights from the font itself.
  const off = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return [...document.querySelectorAll('.btn')].flatMap((btn) => {
      const text = [...btn.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const box = btn.getBoundingClientRect();
      if (!text || !box.height) return [];
      // The button is a flex box: the probe shares a wrapper with the text to sit on its line.
      const wrap = document.createElement('span');
      const probe = document.createElement('span');
      probe.style.display = 'inline-block';
      text.replaceWith(wrap);
      wrap.append(probe, text);
      const baseline = probe.getBoundingClientRect().bottom;
      wrap.replaceWith(text);
      ctx.font = getComputedStyle(btn).font;
      const cap = ctx.measureText('H').actualBoundingBoxAscent;
      const x = ctx.measureText('x').actualBoundingBoxAscent;
      const middle = baseline - (cap + x) / 4;
      return [{ label: text.textContent.trim(), off: +(middle - (box.top + box.height / 2)).toFixed(2) }];
    });
  });
  const bad = off.filter((b) => Math.abs(b.off) > 0.6);
  if (!off.length || bad.length) throw new Error(`${off.length} buttons, off-centre (px, + is low): ${JSON.stringify(bad)}`);
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

await step('now playing screen', async () => {
  await page.click('.pb-cover');
  await page.waitForSelector('.nowplaying');
  await page.waitForTimeout(1200);
  await shot('04-now-playing');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
});

await step('daylist leads "For you" and fits the time of day', async () => {
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('[data-testid="mix-card"]', { timeout: 60000 });
  const first = page.locator('[data-testid="mix-card"]').first();
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

await step('hide a track from the mixes, then bring it back from Settings', async () => {
  await page.locator('[data-testid="mix-card"]').first().click();
  await page.waitForSelector('.track-row');
  const row = page.locator('.track-row').first();
  // By its id: rows off screen are drawn lazily (content-visibility), their text empty until then.
  const id = await row.getAttribute('data-track-id');
  const before = await page.locator('.track-row').count();
  await row.click({ button: 'right' });
  await page.getByText('Скрыть из подборок', { exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.track-row').length === n - 1, before, { timeout: 5000 });
  if (await page.locator(`.track-row[data-track-id="${id}"]`).count()) throw new Error(`track ${id} is still in the mix`);
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  const note = await page.locator('[data-testid="mix-feedback"]').innerText();
  if (!/Скрыто из подборок: 1 трек/.test(note)) throw new Error(`settings: ${note}`);
  await page.click('[data-testid="mix-feedback-reset"]');
  await page.waitForSelector('[data-testid="mix-feedback"]', { state: 'detached', timeout: 3000 });
  await page.click('[data-testid="nav-home"]');
  await page.locator('[data-testid="mix-card"]').first().click();
  await page.waitForFunction((n) => document.querySelectorAll('.track-row').length === n, before, { timeout: 5000 });
  await page.click('[data-testid="nav-home"]');
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
  const item = page.locator('.menu-item', { hasText: 'Добавить в плейлист' });
  await item.hover();
  await page.waitForTimeout(300);
  if ((await page.locator('.menu').count()) < 2) throw new Error('submenu missing');
  // It must open next to the item and inside the window (it once opened far off-screen).
  const [at, sub, size] = [await item.boundingBox(), await page.locator('.menu').nth(1).boundingBox(), page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))];
  const inside = sub.x >= 0 && sub.y >= 0 && sub.x + sub.width <= size.width && sub.y + sub.height <= size.height;
  const beside = Math.abs(sub.x - (at.x + at.width)) < 40 || Math.abs(sub.x + sub.width - at.x) < 40;
  if (!inside || !beside) throw new Error(`submenu at ${JSON.stringify(sub)}, item at ${JSON.stringify(at)}, window ${JSON.stringify(size)}`);
  await shot('06-context-menu');
  await page.keyboard.press('Escape');
});

await step('track details: album, genre and more from the catalog', async () => {
  await page.locator('.track-row').nth(1).click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Информация о треке' }).click();
  await page.waitForSelector('[data-testid="track-info"]', { timeout: 15000 });
  const text = await page.locator('[data-testid="track-info"]').innerText();
  if (!/Альбом/.test(text) || !/Жанр/.test(text) || !/Длительность/.test(text)) throw new Error(`details: ${text}`);
  await page.locator('.track-sheet button', { hasText: 'Закрыть' }).click();
  await page.waitForSelector('.track-sheet', { state: 'detached' });
});

await step('share a track: its link goes to the clipboard', async () => {
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await page.locator('.track-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Поделиться' }).click();
    await page.locator('.menu-item', { hasText: 'Скопировать ссылку' }).click();
    await page.waitForTimeout(300);
    const link = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (!/^https:\/\/music\.yandex\.ru\/(album\/\d+\/)?track\/\d+$/.test(link)) throw new Error(`clipboard: "${link}"`);
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
  }
});

await step('the playing track has its menu: player bar and now playing', async () => {
  await page.locator('.pb-left').click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Поделиться' }).waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu', { state: 'detached' });
  await page.click('.pb-cover');
  await page.waitForSelector('.nowplaying');
  await page.click('[data-testid="np-more"]');
  await page.locator('.menu-item', { hasText: 'Добавить в плейлист' }).waitFor({ timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.menu', { state: 'detached' });
  if (await page.locator('.nowplaying').count()) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nowplaying', { state: 'detached' });
  }
});

await step('uploaded mp3s are marked in a playlist', async () => {
  const found = await page.evaluate(async () => {
    const { useApp, api } = window.__wave;
    const s = useApp.getState();
    for (const p of s.playlists.filter((p) => String(p.uid) === String(s.account?.uid))) {
      const full = await api.playlist(p.uid, p.kind);
      const tracks = (full.tracks || []).map((x) => x.track).filter(Boolean);
      if (tracks.some((t) => t.trackSource === 'UGC')) return { uid: p.uid, kind: p.kind, all: tracks.every((t) => t.trackSource === 'UGC') };
    }
    return null;
  });
  if (!found) return console.log('       no own playlist with uploads on this account');
  await page.evaluate(({ uid, kind }) => window.__wave.navigate({ name: 'playlist', uid, kind }), found);
  await page.waitForSelector('[data-testid="upload-badge"]', { timeout: 15000 });
  // In front of the title (a long title cuts off its end), with the arrow centred in the square.
  const geometry = await page.evaluate(() => {
    const badge = document.querySelector('[data-testid="upload-badge"]');
    const b = badge.getBoundingClientRect();
    const i = badge.querySelector('svg').getBoundingClientRect();
    return { first: badge.parentElement.firstElementChild === badge, dx: i.x + i.width / 2 - (b.x + b.width / 2), dy: i.y + i.height / 2 - (b.y + b.height / 2) };
  });
  if (!geometry.first || Math.abs(geometry.dx) > 0.5 || Math.abs(geometry.dy) > 0.5) throw new Error(`badge: ${JSON.stringify(geometry)}`);
  // Only what the official app offers for an upload, plus removing it from this playlist.
  await page.locator('.track-row', { has: page.locator('[data-testid="upload-badge"]') }).first().click({ button: 'right' });
  await page.waitForSelector('.menu');
  const items = (await page.locator('.menu .menu-item .menu-label').allInnerTexts()).map((x) => x.trim());
  // The official app's order: like, download, don't recommend, add to playlist, edit, details.
  const want = ['Скачать', 'Не рекомендовать', 'Добавить в плейлист', 'Изменить', 'Информация о треке', 'Удалить из плейлиста'];
  if (items.length !== 7 || !/нравится/.test(items[0]) || want.some((w, k) => items[k + 1] !== w)) throw new Error(`upload menu: ${items.join(' | ')}`);
  await page.keyboard.press('Escape');

  // Edit: rename, see it in the list, and always put the real name back.
  const row = page.locator('.track-row', { has: page.locator('[data-testid="upload-badge"]') }).first();
  const original = await page.evaluate(async ({ uid, kind }) => {
    const full = await window.__wave.api.playlist(uid, kind);
    const t = full.tracks.map((x) => x.track).find((t) => t?.trackSource === 'UGC');
    return { id: t.id, title: t.title, artist: (t.artists || []).map((a) => a.name).join(', ') };
  }, found);
  try {
    await row.click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Изменить' }).click();
    await page.fill('[data-testid="edit-title"]', `${original.title} · oni-e2e`);
    await page.click('[data-testid="edit-save"]');
    await page.locator('.track-row .tr-title', { hasText: 'oni-e2e' }).first().waitFor({ timeout: 15000 });
  } finally {
    await page.evaluate(({ id, title, artist }) => window.__wave.api.changeUpload(id, { title, artist }), original);
  }
  // back to the search results the next steps start from
  await page.click('[data-testid="nav-search"]');
  await page.waitForSelector('.section');
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
  // The banner on Home says what the wave follows, and leads back to My Wave. The trip to Home is
  // undone afterwards (route and history), so the navigation steps below start where they did.
  const nav = await page.evaluate(() => {
    const { route, backStack, forwardStack } = window.__wave.useApp.getState();
    return { route, backStack, forwardStack };
  });
  await page.click('[data-testid="nav-home"]');
  try {
    const kicker = await page.locator('[data-testid="wave-kicker"]').innerText();
    const playing = await page.locator('[data-testid="wave-track"]').innerText();
    const desc = `${kicker} / ${playing}`;
    const title = await page.evaluate(() => {
      const s = window.__wave.usePlayer.getState();
      return s.queue[s.index]?.title;
    });
    if (!kicker.toLowerCase().startsWith('волна по исполнителю') || playing !== title) throw new Error(`banner says "${desc}", playing "${title}"`);
    await page.click('[data-testid="wave-back"]');
    await page.waitForFunction(() => {
      const s = window.__wave.usePlayer.getState();
      return s.source?.kind === 'wave' && !s.source.station && s.index >= 0 && !s.waveBusy;
    }, null, { timeout: 30000 });
    // Plain My Wave plays: the banner shows its track too, says "My Wave", and offers no link back
    // to where it already is (the user).
    await page.waitForFunction(() => {
      const s = window.__wave.usePlayer.getState();
      const shown = document.querySelector('[data-testid="wave-track"]')?.textContent;
      return shown === s.queue[s.index]?.title;
    }, null, { timeout: 10000 });
    const now = await page.locator('[data-testid="wave-kicker"]').innerText();
    const link = await page.locator('[data-testid="wave-back"]').count();
    if (!now.toLowerCase().startsWith('моя волна') || link) throw new Error(`My Wave banner: "${now}", link ${link}`);
    console.log(`       banner: ${desc}; then "${now}"`);
  } finally {
    await page.evaluate((n) => window.__wave.useApp.setState(n), nav);
  }
  await page.waitForSelector('[data-testid="radio"]');
});

await step('back navigation', async () => {
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForSelector('.page-header .page-cover:not(.round)');
});

await step('back and forward: mouse 4/5, Alt+arrows, the shell command', async () => {
  const at = () => page.evaluate(() => window.__wave.useApp.getState().route.name);
  const wait = async (name) =>
    page.waitForFunction((n) => window.__wave.useApp.getState().route.name === n, name, { timeout: 5000 }).catch(async () => {
      throw new Error(`want ${name}, at ${await at()}`);
    });
  const side = (button) =>
    page.evaluate((b) => {
      window.dispatchEvent(new MouseEvent('mousedown', { button: b }));
      window.dispatchEvent(new MouseEvent('mouseup', { button: b }));
    }, button);
  await page.click('[data-testid="nav-home"]');
  await page.click('[data-testid="nav-search"]');
  await page.click('[data-testid="nav-history"]');
  // The previous step ended with Alt+Left: a press within 300 ms of it counts as the same one.
  await page.waitForTimeout(350);
  await side(3);
  await wait('search');
  await page.waitForTimeout(350);
  await side(4);
  await wait('history');
  await page.waitForTimeout(350);
  await page.keyboard.press('Alt+ArrowLeft');
  await wait('search');
  await page.waitForTimeout(350);
  const win = await app.browserWindow(page);
  await win.evaluate((w) => w.webContents.send('wave:command', 'back'));
  await wait('home');
  await page.waitForTimeout(350);
  await page.keyboard.press('Alt+ArrowRight');
  await wait('search');
  if ((await at()) !== 'search') throw new Error('Alt+Right');
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
  await page.click('[data-testid="list-search"]');
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

await step('Liked opened again shows the whole list and its Download button at once', async () => {
  // The user: Download came up late on Liked (it waited for the rest of the list after the first
  // hundred). Seen once, the list is kept and shows right away; the fresh one replaces it quietly.
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('.wave-hero');
  const t0 = Date.now();
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('[data-testid="download-all"]', { timeout: 15000 });
  const ms = Date.now() - t0;
  const rows = await page.locator('.track-row').count();
  const keys = await page.evaluate(() => window.__wave.useApp.getState().likedKeys.length);
  console.log(`       Download after ${ms} ms, ${rows} of ${keys} rows`);
  if (ms > 500 || rows < keys) throw new Error(`Download after ${ms} ms, ${rows} of ${keys} rows`);
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

await step('settings page', async () => {
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  await page.waitForSelector('.panel');
  await shot('11-settings');
});

await step('download new likes: a track liked downloads by itself (like and download reverted)', async () => {
  // The user's wish (accepted proposals), as in Yandex's app.
  await page.locator('label', { has: page.locator('[data-testid="auto-likes"]') }).click();
  let id = null;
  try {
    id = await page.evaluate(async () => {
      const w = window.__wave;
      const liked = w.useApp.getState().liked;
      const t = (await w.api.chart()).find((x) => x.available !== false && !liked.has(String(x.id)) && !w.offline.has(x.id));
      await w.toggleLike(t);
      return String(t.id);
    });
    await page.waitForFunction((id) => window.__wave.offline.has(id), id, { timeout: 60000 });
  } finally {
    await page.evaluate(async (id) => {
      const w = window.__wave;
      if (id && w.useApp.getState().liked.has(id)) {
        const [t] = await w.api.tracks([id]);
        await w.toggleLike(t);
      }
      if (id) await w.offline.remove(id);
    }, id);
    await page.locator('label', { has: page.locator('[data-testid="auto-likes"]') }).click();
    await page.evaluate(() => document.activeElement?.blur());
  }
});

await step('crossfade: the next track starts before this one ends, both sound for a while, then the old one is silent', async () => {
  // The user's wish (accepted proposals). Settings is open from the steps above.
  await page.locator('[data-testid="crossfade"]').fill('4');
  try {
    await page.evaluate(async () => {
      const chart = (await window.__wave.api.chart()).filter((t) => t.available !== false && t.durationMs > 60000).slice(0, 2);
      await window.__wave.playTracks(chart, 0, 'e2e crossfade');
    });
    await waitPlaying(0.5);
    await page.waitForFunction(() => Number.isFinite(window.__wave.audio.duration), null, { timeout: 10000 });
    await page.evaluate(() => (window.__wave.audio.currentTime = window.__wave.audio.duration - 6));
    // Both playing at once: the crossing.
    await page.waitForFunction(() => window.__wave.audio.elements.every((el) => !el.paused) && window.__wave.usePlayer.getState().index === 1, null, { timeout: 15000 }).catch(async () => {
      throw new Error(`no overlap: ${JSON.stringify(await page.evaluate(() => ({ index: window.__wave.usePlayer.getState().index, els: window.__wave.audio.elements.map((el) => ({ paused: el.paused, t: el.currentTime, v: el.volume })) })))}`);
    });
    // Then the old one is silent and stopped, the new one at full volume, alone (the old one may
    // reach its end a moment before the fade does: wait for the fade, not for the old one).
    await page.waitForFunction(() => { const a = window.__wave.audio; return a.elements.filter((el) => !el.paused).length === 1 && Math.abs(a.el.volume - a.volume) < 0.01; }, null, { timeout: 8000 });
    const end = await page.evaluate(() => ({ volume: window.__wave.audio.volume, el: window.__wave.audio.el.volume, playing: !window.__wave.audio.paused }));
    if (!end.playing || Math.abs(end.el - end.volume) > 0.01) throw new Error(`after the crossing: ${JSON.stringify(end)}`);
  } finally {
    await page.locator('[data-testid="crossfade"]').fill('0');
    await page.evaluate(() => document.activeElement?.blur());
    await page.evaluate(() => window.__wave.audio.pause());
  }
});

await step('crossfade, the next track slow to load: the old one ends meanwhile, and the next still plays (not skipped)', async () => {
  // The user's worry: tracks often load slowly. The crossing starts 4 s before the end, the next
  // track's address takes 5 s, so the old one ends first; its end must not count as a skip. Its
  // early fetch (prefetchNext) fails, so the crossing asks again and waits. Other tracks than the
  // step above (each left half played counts as a skip, and two demote the artist).
  await page.locator('[data-testid="crossfade"]').fill('4');
  try {
    const want = await page.evaluate(async () => {
      const w = window.__wave;
      const chart = (await w.api.chart()).filter((t) => t.available !== false && t.durationMs > 60000).slice(4, 7);
      const slow = String(chart[1].id);
      const stream = w.api.stream.bind(w.api);
      w.api.stream = async (id, ...rest) => {
        if (String(id) === slow && !window.__slowArmed) throw new Error('not yet');
        if (String(id) === slow) await new Promise((r) => setTimeout(r, 5000));
        return stream(id, ...rest);
      };
      window.__restoreStream = () => delete w.api.stream;
      await w.playTracks(chart, 0, 'e2e crossfade slow');
      return slow;
    });
    await waitPlaying(0.5);
    await page.waitForFunction(() => Number.isFinite(window.__wave.audio.duration), null, { timeout: 10000 });
    await page.evaluate(() => {
      window.__slowArmed = true;
      window.__wave.audio.currentTime = window.__wave.audio.duration - 4.5;
    });
    await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.audio.currentTime > 1 && window.__wave.usePlayer.getState().index > 0, null, { timeout: 20000 });
    await page.waitForTimeout(1500);
    const now = await page.evaluate(() => { const s = window.__wave.usePlayer.getState(); return { index: s.index, id: String(s.queue[s.index]?.id), playing: !window.__wave.audio.paused }; });
    if (now.index !== 1 || now.id !== want || !now.playing) throw new Error(`skipped past the slow track: ${JSON.stringify(now)}`);
  } finally {
    await page.evaluate(() => window.__restoreStream?.());
    await page.locator('[data-testid="crossfade"]').fill('0');
    await page.evaluate(() => document.activeElement?.blur());
    await page.evaluate(() => window.__wave.audio.pause());
  }
});

await step('tracks that will not play: the downloads stand in, and the list comes back where it stopped', async () => {
  // A friend of the user's saw tracks switch by themselves, fast: one that would not start put
  // the app "offline" and it ran through the queue. Now three in a row that will not start (Yandex
  // refusing here) hand over to the downloads (the user's wish), and once Yandex gives the track
  // again, the list comes back at it after the downloaded track.
  const fresh = await page.evaluate(async () => (await window.__wave.api.chart()).filter((t) => t.available !== false).slice(30, 38));
  const standIn = await page.evaluate(async () => {
    const t = (await window.__wave.api.chart()).filter((x) => x.available !== false)[40];
    await window.__wave.offline.download(t);
    return String(t.id);
  });
  const refuse = () =>
    page.evaluate(() => {
      window.__asked = new Set();
      window.__wave.api.stream = async (id) => {
        window.__asked.add(String(id));
        throw Object.assign(new Error('too-many-requests'), { status: 429 });
      };
    });
  const give = () => page.evaluate(() => delete window.__wave.api.stream);
  const where = (why) => async () => {
    throw new Error(`${why}: ${JSON.stringify(await page.evaluate(() => { const s = window.__wave.usePlayer.getState(); return { title: s.source?.title, list: s.source?.list, index: s.index, id: String(s.queue[s.index]?.id), q: s.queue.length, paused: window.__wave.audio.paused, offline: window.__wave.useApp.getState().offline, toast: document.querySelector('.toast')?.textContent }; }))}`);
  };
  try {
    await refuse();
    await page.evaluate((tracks) => window.__wave.playTracks(tracks, 0, 'e2e refused'), fresh);
    await page.waitForSelector('.toast:has-text("пока играет скачанное")', { timeout: 15000 });
    await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.list === 'downloads' && !window.__wave.audio.paused, null, { timeout: 15000 }).catch(where('no downloads playing'));
    const st = await page.evaluate(() => ({ tried: window.__asked.size, offline: window.__wave.useApp.getState().offline, id: String(window.__wave.usePlayer.getState().queue[window.__wave.usePlayer.getState().index]?.id) }));
    if (st.tried > 4 || st.offline) throw new Error(`stand-in: ${JSON.stringify(st)}`);
    // Yandex gives tracks again, but not the first one (broken for good, the user asked about
    // it): the probe goes on to the next; at the downloaded track's end, the list at that one.
    await page.evaluate((broken) => {
      const real = Object.getPrototypeOf(window.__wave.api).stream.bind(window.__wave.api);
      window.__wave.api.stream = async (id, ...rest) => {
        if (String(id) === broken) throw Object.assign(new Error('not available'), { status: 404 });
        return real(id, ...rest);
      };
    }, String(fresh[0].id));
    await page.waitForTimeout(4500);
    await page.evaluate(() => window.__wave.audio.dispatchEvent(new Event('ended')));
    await page.waitForFunction((second) => { const s = window.__wave.usePlayer.getState(); return s.source?.title === 'e2e refused' && String(s.queue[s.index]?.id) === second; }, String(fresh[1].id), { timeout: 15000 }).catch(where('not back to the list at the next track'));
    await give();
    // Nothing downloaded: it waits with a message, and the music goes on by itself.
    await page.evaluate(() => {
      window.__entries = window.__wave.offline.entries;
      window.__wave.offline.entries = () => [];
    });
    await refuse();
    await page.evaluate((tracks) => window.__wave.playTracks(tracks, 0, 'e2e refused'), fresh.slice(4));
    await page.waitForSelector('.toast:has-text("скачанного нет")', { timeout: 15000 });
    if (!(await page.evaluate(() => window.__wave.audio.paused))) throw new Error('playing with nothing to play');
    await give();
    await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.usePlayer.getState().source?.title === 'e2e refused', null, { timeout: 20000 }).catch(where('did not go on by itself'));
    console.log(`       stand-in ${st.id === standIn ? 'the downloaded track' : st.id}, back to the list; with nothing downloaded it waited and went on`);
  } finally {
    await page.evaluate(() => {
      delete window.__wave.api.stream;
      if (window.__entries) window.__wave.offline.entries = window.__entries;
      window.__wave.audio.pause();
    });
    await page.evaluate((id) => window.__wave.offline.remove(id), standIn);
  }
});

await step('keyboard: space toggles playback', async () => {
  // Nothing focused (a click could land on a switch of the page open, and space would flip it).
  await page.evaluate(() => document.activeElement?.blur());
  const before = await page.evaluate(() => window.__wave.audio.paused);
  await page.keyboard.press('Space');
  await page.waitForFunction((b) => window.__wave.audio.paused !== b, before);
  await page.keyboard.press('Space');
  await page.waitForFunction((b) => window.__wave.audio.paused === b, before);
});

await step('player bar, a narrow window: the source label does not run under the buttons', async () => {
  // The user's screenshot: "Radio: Li" under the moon at a smaller window. From the narrowest
  // window Windows allows (960) up: the right side's items side by side, the label cut short or hidden.
  const win = await app.browserWindow(page);
  const size = await win.evaluate((w) => w.getSize());
  try {
    await page.evaluate(() => window.__wave.usePlayer.setState({ source: { kind: 'list', title: 'Радио: Мне нравится, очень длинное название' } }));
    for (const width of [960, 1040, 1120, 1280, 1400]) {
      await win.evaluate((w, x) => w.setSize(x, 800), width);
      await page.waitForTimeout(250);
      const bad = await page.evaluate(() => {
        const right = document.querySelector('.pb-right');
        const bar = document.querySelector('.playerbar').getBoundingClientRect();
        const items = [...right.children].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 0);
        const out = [];
        for (let i = 1; i < items.length; i++) if (items[i].r.left < items[i - 1].r.right - 0.5) out.push(`${items[i - 1].el.className} overlaps ${items[i].el.className}`);
        for (const { el, r } of items) if (r.right > bar.right + 0.5) out.push(`${el.className} past the bar`);
        // Cut short, it ends in "…" (a flex box clips its text mid-letter instead); too short, it is gone.
        const label = right.querySelector('.pb-source');
        const width = label ? label.getBoundingClientRect().width : 0;
        if (width > 0) {
          const holder = [label, ...label.querySelectorAll('*')].find((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
          const css = getComputedStyle(holder);
          if (holder.scrollWidth > holder.clientWidth + 1 && (css.textOverflow !== 'ellipsis' || css.display.includes('flex'))) out.push('label cut mid-letter, no "…"');
          if (width < 40) out.push(`label squeezed to ${width.toFixed(0)}px`);
        }
        return out;
      });
      if (bad.length) throw new Error(`${width}px: ${bad.join('; ')}`);
    }
  } finally {
    await win.evaluate((w, [x, y]) => w.setSize(x, y), size);
  }
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
  // The tab bar has Settings (sign-out, language), and no sidebar toggle that does nothing here.
  if (await page.locator('[data-testid="sidebar-toggle"]').isVisible()) throw new Error('sidebar toggle shown on a phone');
  await page.click('[data-testid="nav-settings"]');
  await page.waitForSelector('.page-title');
  await page.waitForTimeout(600);
  await shot('16-phone-settings');
  // The full now-playing screen keeps every control; only the bar drops some.
  await page.click('.pb-cover');
  await page.waitForSelector('.nowplaying');
  const shown = await page.locator('.transport.big > button').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
  if (shown < 5) throw new Error(`now playing on a phone shows ${shown} of 5 controls`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
  await page.click('[data-testid="nav-home"]');
  await win.evaluate((w) => w.setSize(1320, 840));
});

await step('live cover: Yandex cover video plays with the music', async () => {
  const has = await page.evaluate(async () => {
    const withVideo = (await window.__wave.api.chart()).filter((t) => t.backgroundVideoUri);
    if (withVideo.length) await window.__wave.playTracks(withVideo, 0, 'e2e');
    return withVideo.length;
  });
  if (!has) return console.log('       no chart track has a cover video today');
  await waitPlaying(0.5);
  await page.click('.pb-cover');
  await page.waitForSelector('[data-testid="live-video"] video', { timeout: 5000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-testid="live-video"] video');
    return v && !v.paused && v.currentTime > 0.5;
  }, null, { timeout: 15000 });
  await shot('14-live-cover');
  await page.evaluate(() => window.__wave.audio.pause());
  await page.waitForFunction(() => document.querySelector('[data-testid="live-video"] video')?.paused, null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
});

await step('smart shuffle mixes suggestions into liked songs', async () => {
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('[data-testid="smart-shuffle"]:not([disabled])', { timeout: 20000 });
  await page.click('[data-testid="smart-shuffle"]');
  await waitPlaying(0.5, 40000);
  const n = await page.evaluate(() => {
    const s = window.__wave.usePlayer.getState();
    return s.source?.kind === 'list' ? (s.source.suggested?.length ?? 0) : -1;
  });
  if (n <= 0) throw new Error(`no suggestions (${n})`);
  await page.click('.pb-cover');
  await page.waitForSelector('[data-testid="suggested"]', { timeout: 5000 });
  console.log(`       ${n} suggestions in the queue`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.nowplaying', { state: 'detached' });
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('beat pulse follows the music', async () => {
  await page.evaluate(() => window.__wave.audio.play());
  await waitPlaying(0.5);
  const max = await page.evaluate(
    () =>
      new Promise((r) => {
        let m = 0;
        const t = setInterval(() => (m = Math.max(m, window.__wave.pulseLevel())), 40);
        setTimeout(() => (clearInterval(t), r(m)), 4000);
      }),
  );
  if (max < 0.2) {
    const info = await page.evaluate(() => { const a = window.__wave.audio; const s = window.__wave.usePlayer.getState(); return { src: a.src.slice(0, 40), t: a.currentTime, paused: a.paused, title: s.queue[s.index]?.title, source: s.source?.title, eq: window.__wave.eqOutputLevel?.() }; });
    // GitHub's machines have no sound card: now and then the music reaches Web Audio as pure silence
    // (the equalizer's output 0 too). That says nothing about the pulse; on a PC it stays a failure.
    if (process.env.CI && max === 0 && !info.eq) return console.log('       skipped: no sound reaches Web Audio on this machine');
    throw new Error(`no beats detected (max ${max}) ${JSON.stringify(info)}`);
  }
  // The covers throb, and only they get the beat: set on the page's root it restyled every
  // element each frame (the user: the app stutters; Liked fell from ~180 to ~35 frames a second).
  const cover = await page.evaluate(() => Number(document.querySelector('.pb-cover .cover')?.style.getPropertyValue('--beat') || -1));
  if (cover < 0) throw new Error('the player cover has no beat');
  if (await page.evaluate(() => document.documentElement.style.getPropertyValue('--beat'))) throw new Error('the beat is set on the page root');
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('.track-row', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const frame = await page.evaluate(async () => {
    const gaps = [];
    let last = performance.now();
    const end = last + 3000;
    await new Promise((done) => {
      const f = (t) => (gaps.push(t - last), (last = t), t < end ? requestAnimationFrame(f) : done());
      requestAnimationFrame(f);
    });
    return gaps.sort((x, y) => x - y)[gaps.length >> 1];
  });
  console.log(`       ${await page.locator('.track-row').count()} rows with the pulse on: a frame takes ${frame.toFixed(1)} ms`);
  if (frame > 25 * SLOW) throw new Error(`a long list with the pulse stutters: ${frame.toFixed(1)} ms a frame`);
  await page.evaluate(() => window.__wave.audio.pause());
  await page.waitForFunction(() => document.querySelector('.pb-cover .cover')?.style.getPropertyValue('--beat') === '0', null, { timeout: 3000 });
});

await step('sound settings: equalizer hears the music', async () => {
  await page.evaluate(() => window.__wave.playTracks(window.__wave.usePlayer.getState().queue.slice(0, 5), 0, 'e2e'));
  await waitPlaying(1);
  await page.click('[data-testid="sound-button"]');
  await page.waitForSelector('[data-testid="sound-panel"]');
  await page.locator('[data-testid="eq-toggle"]').check();
  await page.click('[data-testid="eq-preset"]');
  await page.click('[data-testid="preset-bass"]');
  // A CORS-blocked stream would reach Web Audio as silence.
  await page.waitForFunction(() => (window.__wave.eqOutputLevel() ?? 0) > 0.005, null, { timeout: 10000 });
  await page.locator('[data-testid="eq-toggle"]').uncheck();
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="sound-panel"]', { state: 'detached' });
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('history: this app and all devices', async () => {
  await page.click('[data-testid="nav-history"]');
  // Earlier steps played several tracks for longer than the 5 s that counts as a play.
  await page.waitForSelector('.history-group .track-row', { timeout: 10000 });
  const local = await page.locator('.history-group').count();
  await page.click('[data-testid="history-yandex"]');
  await page.waitForSelector('.history-group .track-row, .empty-hint, .error-box', { timeout: 30000 });
  if (await page.locator('.error-box').count()) throw new Error(await page.locator('.error-box').innerText());
  console.log(`       in this app: ${local} groups; from Yandex: ${await page.locator('.history-group .track-row').count()} tracks`);
  await shot('13-history');
  // Found by the user: a track started from History showed "My Wave" (the run's source) on the home
  // banner, not where it was started from. Both tabs: Yandex's, then this app's.
  for (const tab of ['history-yandex', 'history-app']) {
    await page.click(`[data-testid="${tab}"]`);
    await page.locator('.history-group .track-row').first().dblclick();
    await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.kind === 'list', null, { timeout: 15000 });
    const title = await page.evaluate(() => window.__wave.usePlayer.getState().source?.title);
    if (title !== 'История') throw new Error(`${tab}: playing from "${title}", not "История"`);
  }
  await page.click('[data-testid="nav-home"]');
  const kicker = await page.locator('[data-testid="wave-kicker"]').innerText();
  if (!/история/i.test(kicker)) throw new Error(`home banner: "${kicker}"`);
  await page.evaluate(() => window.__wave.audio.pause());
  await page.click('[data-testid="nav-history"]');
});

await step('recap: the month summed up from the plays (here and, for the last days, everywhere); play it, save it as a playlist (removed again)', async () => {
  await page.click('[data-testid="history-recap"]');
  await page.waitForSelector('[data-testid="recap-track"]', { timeout: 30000 });
  const minutes = await page.locator('[data-testid="recap-minutes"] b').innerText();
  const tracks = await page.locator('[data-testid="recap-track"]').count();
  const artists = await page.locator('[data-testid="recap-artist"]').count();
  if (!tracks || !artists || !/^[\d\s ]+$/.test(minutes)) throw new Error(`recap: ${minutes} min, ${tracks} tracks, ${artists} artists`);
  // "Play" plays the top in its order.
  await page.click('[data-testid="recap-play"]');
  await page.waitForFunction(() => { const s = window.__wave.usePlayer.getState(); return s.source?.title?.startsWith('Итоги') && s.queue.length > 0; }, null, { timeout: 15000 });
  await page.evaluate(() => window.__wave.audio.pause());
  // Saved as a playlist "Recap: <month>", then deleted (the account stays as it was, whatever
  // happens): only the one this step made, not a recap the user saved before.
  const kinds = await page.evaluate(async () => (await window.__wave.api.playlists()).map((p) => p.kind));
  const saved = () => page.evaluate(async (old) => (await window.__wave.api.playlists()).filter((p) => !old.includes(p.kind) && p.title?.startsWith('Итоги:')).map((p) => ({ kind: p.kind, title: p.title, count: p.trackCount })), kinds);
  let made = [];
  try {
    await page.click('[data-testid="recap-save"]');
    await page.waitForSelector('.toast:has-text("Итоги:")', { timeout: 15000 });
    made = await saved();
  } finally {
    for (const p of await saved()) await page.evaluate((kind) => window.__wave.api.deletePlaylist(kind), p.kind);
  }
  if (!made.length || !made[0].count) throw new Error(`saved: ${JSON.stringify(made)}`);
  console.log(`       ${minutes} min, ${tracks} tracks, ${artists} artists; saved "${made[0].title}" (${made[0].count}), removed`);
});

await step('recap as stories: cards one after another, the summary copied as a 1080×1920 picture', async () => {
  // The user's pick after 1.9.0. Recap is open from the step above.
  await page.click('[data-testid="recap-stories-open"]');
  await page.waitForSelector('[data-testid="recap-stories"]');
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const card = await page.locator('[data-testid="story-card"]').getAttribute('data-card');
    if (!seen.includes(card)) {
      seen.push(card);
      await shot(`story-${card}`);
    }
    if (card === 'summary') break;
    await page.click('[data-testid="story-next"]');
    await page.waitForTimeout(450);
  }
  if (seen[0] !== 'intro' || seen.at(-1) !== 'summary' || !seen.includes('minutes')) throw new Error(`cards: ${seen}`);
  await page.click('[data-testid="story-copy"]');
  await page.waitForSelector('.toast', { timeout: 15000 });
  // Read back through the page (this Electron's clipboard in the main process has no images).
  const size = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const bitmap = await createImageBitmap(await items[0].getType('image/png'));
    return { width: bitmap.width, height: bitmap.height };
  });
  if (size.width !== 1080 || size.height !== 1920) throw new Error(`picture ${JSON.stringify(size)}`);
  await page.click('[data-testid="stories-close"]');
  await page.waitForSelector('[data-testid="recap-stories"]', { state: 'detached' });
  console.log(`       cards: ${seen.join(', ')}`);
});

await step('english interface has no Russian left', async () => {
  // Only the app's own chrome: titles, tabs, buttons, tooltips. Yandex data stays as it is
  // (also in the Home banner: the playing track, its artists, where it plays from).
  const CHROME = [
    '.nav > .nav-item', '.nav-section > span', '.page-title', '.section-head h2', '.tabs .tab', '.kicker',
    '.wave-hero h1', '.wave-hero .btn', '.panel h3', '.panel .hint', '.empty-hint', '.pb-empty', '.lib-actions .btn',
  ].join(',');
  const leftovers = async () =>
    page.evaluate((sel) => {
      const data = '.wave-track, [data-testid="wave-kicker"], [data-testid="wave-desc"]';
      const texts = [...document.querySelectorAll(sel)].filter((el) => !el.closest(data)).map((el) => el.textContent);
      const titles = [...document.querySelectorAll('button[title], [aria-label]')]
        .filter((el) => !el.closest(`.nav-playlists, .track-row, .q-row, .card, ${data}`))
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
    ['history', '[data-testid="history-app"]'],
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
