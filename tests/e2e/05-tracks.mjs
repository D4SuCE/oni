// e2e: tracks (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { app, page, step, shot, player, waitPlaying } from './harness.mjs';

await step('Escape leaves the search opened from the side panel', async () => {
  // The user, 26.10.2026: the search opened on the left closes with Escape.
  const from = await page.evaluate(() => window.__wave.useApp.getState().route.name);
  await page.click('[data-testid="nav-search"]');
  await page.waitForSelector('[data-testid="search-input"]');
  await page.keyboard.press('Escape');
  await page.waitForFunction((want) => window.__wave.useApp.getState().route.name === want, from, { timeout: 3000 });
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

await step('track details can be copied: a click, a selection with Ctrl+C, the right button', async () => {
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  const clip = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const reset = () => app.evaluate(({ clipboard }) => clipboard.writeText(''));
  try {
    await page.locator('.track-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Информация о треке' }).click();
    await page.waitForSelector('[data-testid="track-info"]', { timeout: 15000 });
    const row = (label) => page.locator('.info-row', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
    // A click on a value copies it, and says so.
    await reset();
    const artists = (await row('Исполнители').innerText()).trim();
    await row('Исполнители').click();
    await page.locator('.toast', { hasText: 'Скопировано' }).waitFor({ timeout: 5000 });
    if ((await clip()) !== artists) throw new Error(`click copied "${await clip()}", the row says "${artists}"`);
    // The title in the header too.
    await reset();
    const title = (await page.locator('.track-sheet h3').innerText()).trim();
    await page.locator('.track-sheet h3').click();
    await page.waitForTimeout(300);
    if ((await clip()) !== title) throw new Error(`title copied "${await clip()}", the header says "${title}"`);
    // The album stays a link: a click opens it, so its copy is the right button's.
    await reset();
    const album = (await row('Альбом').innerText()).trim();
    await row('Альбом').click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Скопировать' }).click();
    await page.waitForTimeout(300);
    if ((await clip()) !== album) throw new Error(`menu copied "${await clip()}", the album is "${album}"`);
    // Selected with the mouse (a double click picks a word), Ctrl+C copies just that.
    await reset();
    // On the text itself: the row is wider than its value, and its middle is often empty.
    const duration = row('Длительность');
    await duration.dblclick({ position: { x: 4, y: 8 } });
    const selection = await page.evaluate(() => getSelection().toString());
    if (!selection.trim()) throw new Error('nothing selected in the details');
    // The double click's first click copied the whole value: what Ctrl+C copies is seen apart from it.
    await page.waitForTimeout(300);
    await reset();
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(300);
    if ((await clip()) !== selection) throw new Error(`Ctrl+C copied "${await clip()}", selected "${selection}"`);
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
    // Left open, the sheet would cover the window for the steps after this one.
    if (await page.locator('.menu').count()) await page.keyboard.press('Escape');
    if (await page.locator('.track-sheet').count()) await page.locator('.track-sheet button', { hasText: 'Закрыть' }).click();
    await page.waitForSelector('.track-sheet', { state: 'detached' });
  }
});

await step('share a track: its link goes to the clipboard', async () => {
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await page.locator('.track-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Поделиться' }).click();
    await page.locator('.menu-item', { hasText: 'Скопировать ссылку' }).click();
    await page.waitForTimeout(300);
    const link = await app.evaluate(({ clipboard }) => clipboard.readText());
    if (!/^https:\/\/oni-music\.github\.io\/#track\/\d+$/.test(link)) throw new Error(`clipboard: "${link}"`);
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
  }
});

await step('a dislike pressed by mistake: undone from its toast, or from the menu (Recommend again), or in Settings (reverted)', async () => {
  // The user, 27.10.2026: a track marked by mistake could not be brought back.
  const marks = () => page.evaluate(() => [...window.__wave.useApp.getState().disliked]);
  const before = await marks();
  try {
    await page.locator('.track-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Не рекомендовать' }).click();
    await page.locator('[data-testid="toast-action"]', { hasText: 'Отменить' }).click({ timeout: 10000 });
    await page.locator('.toast', { hasText: 'Снова будет звучать' }).waitFor({ timeout: 10000 });
    if ((await marks()).length !== before.length) throw new Error('the toast did not undo it');
    if ((await page.evaluate(() => window.__wave.api.dislikedTrackIds())).length !== before.length) throw new Error('Yandex still has it');
    // marked again: its menu brings it back
    await page.locator('.track-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Не рекомендовать' }).click();
    await page.waitForFunction((n) => window.__wave.useApp.getState().disliked.size === n + 1, before.length);
    await page.locator('.track-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Снова рекомендовать' }).click();
    await page.waitForFunction((n) => window.__wave.useApp.getState().disliked.size === n, before.length, { timeout: 10000 });
    // and the list in Settings, a track to bring back by its button
    await page.locator('.track-row').nth(1).click({ button: 'right' });
    await page.locator('.menu-item', { hasText: 'Не рекомендовать' }).click();
    await page.waitForFunction((n) => window.__wave.useApp.getState().disliked.size === n + 1, before.length);
    const was = await page.evaluate(() => window.__wave.useApp.getState().route);
    await page.evaluate(() => window.__wave.navigate({ name: 'settings' }));
    await page.locator('[data-testid="disliked-toggle"]').click();
    await page.locator('[data-testid="disliked-row"]').first().waitFor({ timeout: 15000 });
    const rows = await page.locator('[data-testid="disliked-row"]').count();
    await page.locator('[data-testid="disliked-back"]').first().click();
    await page.waitForFunction((n) => window.__wave.useApp.getState().disliked.size === n, before.length, { timeout: 10000 });
    console.log(`       ${rows} in the Settings list`);
    await page.evaluate((r) => window.__wave.navigate(r), was);
    await page.locator('.track-row').nth(1).waitFor({ timeout: 15000 });
  } finally {
    const extra = (await marks()).filter((id) => !before.includes(id));
    if (extra.length) await page.evaluate((ids) => window.__wave.api.setDisliked(ids, false), extra);
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

await step('links: Share, an oni:// link from a browser, a Yandex link pasted into Search', async () => {
  // "Share" gives Oni's page (site/); the oni:// link it opens comes from a browser as a second start
  // of Oni (electron/main.cjs). A track link plays the track, the others open their page.
  const t = (await page.evaluate(() => window.__wave.api.search('Кино Группа крови', 'track'))).tracks.results[0];
  const album = t.albums[0].id;
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await page.evaluate((id) => window.__wave.navigate({ name: 'album', id }), album);
    await app.evaluate(({ clipboard }) => clipboard.writeText(''));
    await page.click('[data-testid="share"]');
    let shared = '';
    for (let i = 0; i < 20 && !shared; i++) {
      await page.waitForTimeout(250);
      shared = await app.evaluate(({ clipboard }) => clipboard.readText());
    }
    if (shared !== `https://oni-music.github.io/#album/${album}`) throw new Error(`Share copied ${shared}`);
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clip);
  }

  const browser = (link) => app.evaluate(({ app }, link) => app.emit('second-instance', {}, ['Oni.exe', link], ''), link);
  await browser(`oni://track/${t.id}/`); // Windows' way: a slash at the end
  await page.waitForFunction((id) => {
    const s = window.__wave.usePlayer.getState();
    return String(s.queue[s.index]?.id) === String(id);
  }, t.id, { timeout: 15000 });
  await waitPlaying(0.5);

  const { login, kind } = await page.evaluate(() => ({ login: window.__wave.useApp.getState().account.login, kind: window.__wave.useApp.getState().playlists[0]?.kind }));
  if (kind !== undefined) {
    await browser(`oni://playlist/${encodeURIComponent(login)}/${kind}`);
    await page.waitForFunction((kind) => {
      const r = window.__wave.useApp.getState().route;
      return r.name === 'playlist' && String(r.kind) === String(kind);
    }, kind, { timeout: 10000 });
    await page.waitForSelector('.page-title, h1', { timeout: 15000 });
  }

  // Pasted into Search, a link is found as a search finds things (the user: not a track starting
  // out of nowhere): the album on top, its tracks below, nothing new playing.
  const playing = await page.evaluate(() => window.__wave.usePlayer.getState().queue.length);
  await page.click('[data-testid="nav-search"]');
  await page.fill('[data-testid="search-input"]', `https://music.yandex.ru/album/${album}?utm_source=share`);
  await page.waitForSelector('.best', { timeout: 15000 });
  const found = await page.evaluate(() => ({ best: document.querySelector('.best .best-title')?.textContent, rows: document.querySelectorAll('.track-row').length, route: window.__wave.useApp.getState().route.name }));
  if (found.best !== t.albums[0].title || !found.rows || found.route !== 'search') throw new Error(`pasted album: ${JSON.stringify(found)}`);
  await page.fill('[data-testid="search-input"]', `https://oni-music.github.io/#track/${t.id}`);
  await page.waitForFunction((title) => document.querySelector('.best .best-title')?.textContent === title && document.querySelectorAll('.track-row').length === 1, t.title, { timeout: 15000 });
  await shot('05-pasted-link');
  if ((await page.evaluate(() => window.__wave.usePlayer.getState().queue.length)) !== playing) throw new Error('a pasted link started playing');
  await page.fill('[data-testid="search-input"]', '');
});

await step('right click: Paste in a text field, a playlist menu on its card and in the side panel', async () => {
  // The user, 29.10.2026: without a keyboard nothing could be pasted into Search; a playlist's
  // actions without opening it (on the iPhone a held finger sends the same right click).
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText('Кино'));
    await page.click('[data-testid="nav-search"]');
    await page.fill('[data-testid="search-input"]', '');
    await page.click('[data-testid="search-input"]', { button: 'right' });
    await page.locator('.menu-item', { hasText: 'Вставить' }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="search-input"]').value === 'Кино', null, { timeout: 3000 });
    await page.fill('[data-testid="search-input"]', '');

    const pl = await page.evaluate(() => window.__wave.useApp.getState().playlists.find((p) => p.kind !== 3));
    if (pl) {
      await page.evaluate(() => window.__wave.navigate({ name: 'library', tab: 'playlists' }));
      const card = page.locator('.card', { hasText: pl.title }).first();
      await card.waitFor({ timeout: 15000 });
      await card.click({ button: 'right' });
      await page.waitForSelector('.menu');
      const items = await page.locator('.menu .menu-item').allTextContents();
      for (const want of ['Слушать', 'Вперемешку', 'Радио', 'Поделиться', 'Переименовать', 'Удалить плейлист'])
        if (!items.some((x) => x.includes(want))) throw new Error(`the card's menu: ${items.join(' | ')}`);
      await shot('05-playlist-menu');
      await app.evaluate(({ clipboard }) => clipboard.writeText(''));
      await page.locator('.menu-item', { hasText: 'Поделиться' }).click();
      const login = await page.evaluate(() => window.__wave.useApp.getState().account.login);
      const want = `https://oni-music.github.io/#playlist/${encodeURIComponent(login)}/${pl.kind}`;
      let shared = '';
      for (let i = 0; i < 20 && shared !== want; i++) {
        await page.waitForTimeout(250);
        shared = await app.evaluate(({ clipboard }) => clipboard.readText());
      }
      if (shared !== want) throw new Error(`Share from the menu: ${shared}`);
      await page.locator('[data-testid="nav-playlist"]', { hasText: pl.title }).first().click({ button: 'right' });
      await page.waitForSelector('.menu .menu-item');
      if (!(await page.locator('.menu .menu-item', { hasText: 'Вперемешку' }).count())) throw new Error('no menu in the side panel');
      await page.keyboard.press('Escape');
    }
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clip);
  }
});

await step('liked tracks page', async () => {
  await page.click('[data-testid="nav-liked"]');
  await page.waitForSelector('.track-row, .empty-hint', { timeout: 20000 });
  // Library and Liked used to open the same page and both lit up.
  if ((await page.locator('.sidebar .nav-item.active').count()) !== 1) throw new Error('more than one nav item is active');
  await page.waitForTimeout(1500);
  await shot('09-liked');
});
