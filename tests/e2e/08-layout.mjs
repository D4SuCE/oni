// e2e: layout (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { app, page, SLOW, step, shot, waitPlaying } from './harness.mjs';

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

await step('a button showing only its sign gets its hidden words as the tooltip when the mouse comes over it', async () => {
  // The user, 25.10.2026: "many buttons show nothing, one has to guess".
  await page.evaluate(() => {
    const b = Object.assign(document.createElement('button'), { className: 'btn e2e-sign' });
    b.innerHTML = '<svg width="16" height="16"></svg><span style="display:none">Перемешать всё</span>';
    Object.assign(b.style, { position: 'fixed', left: '300px', top: '300px', zIndex: '99999' });
    document.body.append(b);
  });
  try {
    await page.hover('.e2e-sign');
    const title = await page.getAttribute('.e2e-sign', 'title');
    if (title !== 'Перемешать всё') throw new Error(`title "${title}"`);
  } finally {
    await page.evaluate(() => document.querySelector('.e2e-sign')?.remove());
  }
});
