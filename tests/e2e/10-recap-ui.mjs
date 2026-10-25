// e2e: recap ui (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, consoleErrors, step, shot } from './harness.mjs';

await step('recap: the month summed up from the plays (here and, for the last days, everywhere); play it, save it as a playlist (removed again)', async () => {
  // From History, opened here (the steps before may have left another page open).
  await page.click('[data-testid="nav-history"]');
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

await step('where the music plays from follows the interface language: a mix started in Russian reads in English', async () => {
  // Found by the user: "Открытия недели" played, the language was switched to English, and Home
  // still said "Открытия недели". The list keeps what it is (its label), its title is made when shown.
  const language = async (name) => {
    await page.locator('.sidebar > .nav-item', { hasText: /Настройки|Settings/ }).click();
    await page.locator('.segmented button', { hasText: name }).click();
    await page.click('[data-testid="nav-home"]');
    await page.waitForSelector('[data-testid="for-you"] [data-testid="mix-card"]', { timeout: 60000 });
  };
  const card = page.locator('[data-testid="for-you"] [data-testid="mix-card"]').first();
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('[data-testid="for-you"] [data-testid="mix-card"]', { timeout: 60000 });
  const ru = await card.locator('.card-title').innerText();
  await card.hover();
  await card.locator('.card-play').click();
  await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.label?.key === 'mix', null, { timeout: 10000 });
  const shown = async () => ({
    kicker: await page.locator('[data-testid="wave-kicker"]').textContent(), // innerText is upper case (CSS)
    bar: await page.locator('.pb-source-text').innerText(),
  });
  try {
    await language('English');
    const en = await card.locator('.card-title').innerText();
    const after = await shown();
    if (en === ru || !after.kicker.includes(en) || after.bar !== en) throw new Error(`"${ru}" → card "${en}", banner "${after.kicker}", player bar "${after.bar}"`);
  } finally {
    await language('Русский');
  }
  const back = await shown();
  if (!back.kicker.includes(ru) || back.bar !== ru) throw new Error(`back in Russian: banner "${back.kicker}", player bar "${back.bar}"`);
  await page.evaluate(() => window.__wave.audio.pause());
});

await step('animations: on in Settings, a page slides in like a paper door, a press rings; off again', async () => {
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  const all = page.locator('[data-testid="anim-all"]');
  if (await all.isChecked()) throw new Error('animations on in a test run');
  await all.check();
  await page.waitForSelector('[data-testid="anim-hamon"]');
  const on = await page.evaluate(() => ['fusuma', 'scroll', 'cascade', 'hamon'].filter((e) => document.documentElement.classList.contains(`anim-${e}`)).length);
  if (on !== 4) throw new Error(`${on} of 4 effects on`);
  try {
    await page.click('[data-testid="nav-home"]');
    const slide = await page.evaluate(() => getComputedStyle(document.querySelector('.view-enter')).animationName);
    if (slide !== 'fusuma-in') throw new Error(`page comes in with "${slide}"`);
    await page.click('[data-testid="next"]');
    const ring = await page.evaluate(() => document.querySelectorAll('.hamon-ring').length);
    if (!ring) throw new Error('no ring from the press');
    // A finger's ring comes with the tap's click, not as it touches (iOS took a tap that put
    // something on screen for a hover: the user, 25.10.2026, bottom tabs went off on the second tap).
    const touch = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 400));
      const b = document.querySelector('[data-testid="nav-home"]');
      const at = b.getBoundingClientRect();
      const o = { bubbles: true, clientX: at.left + 5, clientY: at.top + 5 };
      // The press's ring may still be there on a slow machine: only new ones count.
      const before = document.querySelectorAll('.hamon-ring').length;
      b.dispatchEvent(new PointerEvent('pointerdown', { ...o, pointerType: 'touch', isPrimary: true, pointerId: 7 }));
      const onTouch = document.querySelectorAll('.hamon-ring').length - before;
      b.dispatchEvent(new PointerEvent('pointerup', { ...o, pointerType: 'touch', isPrimary: true, pointerId: 7 }));
      b.dispatchEvent(new MouseEvent('click', { ...o, detail: 1 }));
      return { onTouch, onClick: document.querySelectorAll('.hamon-ring').length - before };
    });
    if (touch.onTouch || !touch.onClick) throw new Error(`a tap's ring: ${JSON.stringify(touch)}`);
    // A tap iOS sends no click for (rows still coming in under the finger: it took the tap for a
    // hover, the user, 25.10.2026) is a press all the same; its click coming late is not a second one.
    const rescued = await page.evaluate(async () => {
      const b = document.querySelector('[data-testid="nav-history"]');
      const at = b.getBoundingClientRect();
      const o = { bubbles: true, clientX: at.left + 5, clientY: at.top + 5, pointerType: 'touch', isPrimary: true, pointerId: 8 };
      b.dispatchEvent(new PointerEvent('pointerdown', o));
      b.dispatchEvent(new PointerEvent('pointerup', o));
      await new Promise((r) => setTimeout(r, 500));
      const route = window.__wave.useApp.getState().route.name;
      let clicks = 0;
      b.addEventListener('click', () => clicks++);
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: o.clientX, clientY: o.clientY, detail: 1 }));
      return { route, clicks };
    });
    if (rescued.route !== 'history' || rescued.clicks) throw new Error(`a tap with no click: ${JSON.stringify(rescued)}`);
    // A long list: only the first rows come in one after another (all of them at once took the
    // iPhone's memory, and iOS closed the page).
    await page.click('[data-testid="nav-liked"]');
    await page.waitForFunction(() => document.querySelectorAll('.track-row').length > 20, null, { timeout: 30000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('.track-row')].slice(0, 21).map((r) => getComputedStyle(r).animationName));
    if (rows[0] !== 'cascade-in' || rows[20] !== 'none') throw new Error(`rows: first "${rows[0]}", 21st "${rows[20]}"`);
  } finally {
    await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
    await all.uncheck();
  }
  const left = await page.evaluate(() => [...document.documentElement.classList].filter((c) => c.startsWith('anim-')).length);
  if (left) throw new Error(`${left} effects still on`);
});

await step('a long list opens with its first rows and draws the rest a moment later (Liked)', async () => {
  // The user, 25.10.2026: on the iPhone a tab opened only once all of Liked (or History) was drawn.
  await page.click('[data-testid="nav-home"]');
  const seen = await page.evaluate(async () => {
    const total = window.__wave.useApp.getState().likedKeys.length;
    const first = new Promise((resolve) => {
      const watch = new MutationObserver(() => {
        const n = document.querySelectorAll('.track-row').length;
        if (n) {
          watch.disconnect();
          resolve(n);
        }
      });
      watch.observe(document.body, { childList: true, subtree: true });
    });
    window.__wave.navigate({ name: 'library', tab: 'tracks' });
    const atFirst = await first;
    const until = Date.now() + 15000;
    while (document.querySelectorAll('.track-row').length < total && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    return { total, atFirst, atLast: document.querySelectorAll('.track-row').length };
  });
  if (seen.total > 40 && seen.atFirst > 40) throw new Error(`first drawn: ${seen.atFirst} of ${seen.total}`);
  if (seen.atLast < seen.total) throw new Error(`drawn in the end: ${seen.atLast} of ${seen.total}`);
  console.log(`       ${seen.atFirst} rows at first, ${seen.atLast} of ${seen.total} a moment later`);
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
      // Yandex's data: the playing track and where it plays from, and the names in "Skipped".
      const data = '.wave-track, [data-testid="wave-kicker"], [data-testid="wave-desc"], .mix-feedback';
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
