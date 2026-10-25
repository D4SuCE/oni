// e2e: playback (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, step, shot, waitPlaying } from './harness.mjs';

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

await step("smart crossfade: the next track's silence at its start is found and skipped (a made-up track: 1.5 s silence, then a tone)", async () => {
  // The user's pick, 24.10.2026: the next track comes in with its first sound, not with silence.
  const got = await page.evaluate(async () => {
    const rate = 44100;
    const n = rate * 4;
    const pcm = new Int16Array(n);
    for (let i = Math.round(1.5 * rate); i < n; i++) pcm[i] = Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate));
    const wav = new DataView(new ArrayBuffer(44 + n * 2));
    const text = (o, t) => [...t].forEach((ch, k) => wav.setUint8(o + k, ch.charCodeAt(0)));
    text(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, n * 2, true);
    pcm.forEach((v, k) => wav.setInt16(44 + k * 2, v, true));
    const url = URL.createObjectURL(new Blob([wav.buffer], { type: 'audio/wav' }));
    const lead = await window.__wave.silence.leadingSilence(url);
    // The desktop's crossfade starts it from there.
    const a = window.__wave.audio;
    a.volume = 0;
    await a.crossfade(url, 300, () => {}, lead);
    const at = a.currentTime;
    a.pause();
    a.volume = window.__wave.usePlayer.getState().volume;
    URL.revokeObjectURL(url);
    return { lead, at };
  });
  if (Math.abs(got.lead - 1.5) > 0.05 || got.at < 1.4) throw new Error(JSON.stringify(got));
  console.log(`       silence at the start found: ${got.lead.toFixed(2)} s, started at ${got.at.toFixed(2)} s`);
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
