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

await step("crossfade levels: the old track fades at its own level (not lifted to the next one's), the next one comes in at once after a fade-out", async () => {
  // The user, 28.10.2026: "the track is quieter at first, then sharply louder after 1–2 s".
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  await page.locator('[data-testid="crossfade"]').fill('3');
  try {
    const got = await page.evaluate(async () => {
      const w = window.__wave;
      const a = w.audio;
      // A loud one turned down 4 dB, then a quiet one lifted 1 dB (the lift both elements share).
      const chart = (await w.api.chart()).filter((t) => t.available !== false && t.durationMs > 60000).slice(0, 2);
      const tracks = [{ ...chart[0], r128: { i: -4, tp: -1 } }, { ...chart[1], r128: { i: -9, tp: -3 } }];
      await w.playTracks(tracks, 0, 'e2e crossfade levels');
      const until = async (what, ms) => {
        const end = performance.now() + ms;
        while (!what() && performance.now() < end) await new Promise((r) => setTimeout(r, 20));
        return what();
      };
      await until(() => !a.paused && a.currentTime > 0.3 && Number.isFinite(a.duration), 15000);
      const before = a.el.volume;
      const old = a.el;
      a.currentTime = a.duration - 4;
      let highest = 0;
      await until(() => {
        if (!old.paused) highest = Math.max(highest, old.volume);
        return w.usePlayer.getState().index === 1 && a.el !== old && old.paused;
      }, 15000);
      a.pause();

      // Two made-up tracks: the old one silent (its music over), so the next one has nothing to blend with.
      const wav = (seconds, tone) => {
        const rate = 22050;
        const n = rate * seconds;
        const v = new DataView(new ArrayBuffer(44 + n * 2));
        const text = (o, t) => [...t].forEach((ch, k) => v.setUint8(o + k, ch.charCodeAt(0)));
        text(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, tone ? Math.round(12000 * Math.sin((2 * Math.PI * 440 * i) / rate)) : 0, true);
        return URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' }));
      };
      const [quiet, next] = [wav(8, false), wav(8, true)];
      a.src = quiet;
      a.volume = 0.5;
      await a.play();
      const from = a.el;
      await a.crossfade(next, 3000, () => {}, 0, { inMs: 300, fromLevel: 0.5 });
      await new Promise((r) => setTimeout(r, 700));
      const quick = { to: a.el.volume, from: from.volume, fromPlaying: !from.paused };
      a.pause();
      a.volume = w.usePlayer.getState().volume;
      URL.revokeObjectURL(quiet);
      URL.revokeObjectURL(next);
      return { before, highest, quick };
    });
    if (got.highest > got.before + 0.005) throw new Error(`the old track got louder as it faded: ${JSON.stringify(got)}`);
    // 0.7 s into a 3 s crossfade: the new one is in already, the old one still fading.
    if (Math.abs(got.quick.to - 0.5) > 0.01 || !got.quick.fromPlaying || got.quick.from > 0.5 || got.quick.from < 0.3) throw new Error(`after a fade-out: ${JSON.stringify(got)}`);
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

await step('the next track is ready before this one ends: its fresh address on the other element, and it starts at once', async () => {
  // Found reading the code, 5.11.2026: the address asked for when a track began had expired by its end.
  const got = await page.evaluate(async () => {
    const w = window.__wave;
    const a = w.audio;
    const chart = (await w.api.chart()).filter((t) => t.available !== false && t.durationMs > 60000).slice(2, 4);
    await w.playTracks(chart, 0, 'e2e ready');
    const until = async (what, ms) => {
      const end = performance.now() + ms;
      while (!what() && performance.now() < end) await new Promise((r) => setTimeout(r, 20));
      return what();
    };
    await until(() => !a.paused && a.currentTime > 0.3 && Number.isFinite(a.duration), 15000);
    const old = a.el;
    a.currentTime = a.duration - 8;
    await until(() => a.prepared, 8000);
    const prepared = a.prepared;
    const other = a.elements.find((e) => e !== old);
    await until(() => other.readyState >= 3, 6000);
    const buffered = other.readyState;
    const asked = [];
    const stream = w.api.stream.bind(w.api);
    w.api.stream = (id, ...rest) => (asked.push(String(id)), stream(id, ...rest));
    await until(() => w.usePlayer.getState().index === 1, 15000);
    const from = performance.now();
    await until(() => !a.paused && a.currentTime > 0.05, 5000);
    const start = Math.round(performance.now() - from);
    delete w.api.stream;
    const swapped = a.el === other;
    a.pause();
    return { prepared: Boolean(prepared), buffered, askedAgain: asked.filter((id) => id === String(chart[1].id)).length, start, swapped, oldHeard: old.volume };
  });
  if (!got.prepared || !got.swapped || got.askedAgain) throw new Error(JSON.stringify(got));
  console.log(`       the next track started ${got.start} ms after the last one ended`);
});

await step("auto-continue: a list's end goes on with a radio from it, after its tracks; off, the music stops", async () => {
  const got = await page.evaluate(async () => {
    const w = window.__wave;
    const a = w.audio;
    const chart = (await w.api.chart()).filter((t) => t.available !== false && t.durationMs > 60000).slice(5, 7);
    const until = async (what, ms) => {
      const end = performance.now() + ms;
      while (!what() && performance.now() < end) await new Promise((r) => setTimeout(r, 50));
      return what();
    };
    const toEnd = async () => {
      await until(() => !a.paused && a.currentTime > 0.3 && Number.isFinite(a.duration), 15000);
      a.currentTime = a.duration - 2;
    };
    await w.playTracks([chart[0]], 0, 'e2e goes on');
    await toEnd();
    await until(() => w.usePlayer.getState().queue.length > 1 && !a.paused, 25000);
    const s = w.usePlayer.getState();
    const on = { kind: s.source?.kind, seed: s.source?.station?.seed, first: String(s.queue[0]?.id), index: s.index, playing: !a.paused };
    // Turned off: as it always was.
    w.usePlayer.setState({ autoContinue: false });
    await w.playTracks([chart[1]], 0, 'e2e stops');
    await toEnd();
    await until(() => a.paused, 15000);
    await new Promise((r) => setTimeout(r, 500));
    const t = w.usePlayer.getState();
    const off = { kind: t.source?.kind, queue: t.queue.length, paused: a.paused };
    w.usePlayer.setState({ autoContinue: true });
    a.pause();
    return { on, off, want: String(chart[0].id) };
  });
  if (got.on.kind !== 'wave' || got.on.seed !== `track:${got.want}` || got.on.first !== got.want || got.on.index !== 1 || !got.on.playing) throw new Error(`on: ${JSON.stringify(got)}`);
  if (got.off.kind !== 'list' || got.off.queue !== 1 || !got.off.paused) throw new Error(`off: ${JSON.stringify(got)}`);
});

await step("a crossfade does not cut off a list's last track: it plays to its end", async () => {
  // Found reading the code, 5.11.2026: the crossfade set off on the last track too, and with nothing
  // after it, it was paused that many seconds before its end.
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  await page.locator('[data-testid="crossfade"]').fill('4');
  try {
    const got = await page.evaluate(async () => {
      const w = window.__wave;
      const a = w.audio;
      w.usePlayer.setState({ autoContinue: false });
      const t = (await w.api.chart()).filter((x) => x.available !== false && x.durationMs > 60000)[7];
      await w.playTracks([t], 0, 'e2e the last one');
      const until = async (what, ms) => {
        const end = performance.now() + ms;
        while (!what() && performance.now() < end) await new Promise((r) => setTimeout(r, 20));
        return what();
      };
      await until(() => !a.paused && a.currentTime > 0.3 && Number.isFinite(a.duration), 15000);
      a.currentTime = a.duration - 7;
      await until(() => a.paused, 15000);
      const left = a.duration - a.currentTime;
      w.usePlayer.setState({ autoContinue: true });
      return left;
    });
    if (got > 1) throw new Error(`stopped ${got.toFixed(1)} s before its end`);
  } finally {
    await page.locator('[data-testid="crossfade"]').fill('0');
    await page.evaluate(() => document.activeElement?.blur());
    await page.evaluate(() => window.__wave.audio.pause());
  }
});

await step('the queue while shuffled: what is added stays when the shuffle goes off, what is taken out does not come back', async () => {
  const got = await page.evaluate(async () => {
    const w = window.__wave;
    const chart = (await w.api.chart()).filter((t) => t.available !== false).slice(10, 16);
    await w.playTracks(chart.slice(0, 4), 0, 'e2e shuffled');
    w.audio.pause();
    w.toggleShuffle();
    const s = w.usePlayer.getState();
    const out = s.queue[s.index + 1];
    w.removeAt(s.index + 1);
    w.enqueue(chart[4]);
    w.playNext(chart[5]);
    const cur = w.usePlayer.getState().queue[w.usePlayer.getState().index];
    w.toggleShuffle();
    const t = w.usePlayer.getState();
    return { ids: t.queue.map((x) => String(x.id)), index: t.index, playing: String(t.queue[t.index]?.id) === String(cur.id), out: String(out.id), added: [String(chart[4].id), String(chart[5].id)] };
  });
  if (!got.added.every((id) => got.ids.includes(id)) || got.ids.includes(got.out) || !got.playing || got.ids.length !== 5) throw new Error(JSON.stringify(got));
});

await step('the sleep timer called off while it fades: the music goes on at its volume', async () => {
  const got = await page.evaluate(async () => {
    const w = window.__wave;
    const a = w.audio;
    const t = (await w.api.chart()).filter((x) => x.available !== false && x.durationMs > 60000)[9];
    await w.playTracks([t], 0, 'e2e sleep');
    const end = performance.now() + 15000;
    while ((a.paused || a.currentTime < 0.2) && performance.now() < end) await new Promise((r) => setTimeout(r, 50));
    const before = a.volume;
    w.setSleep(0.0005); // 30 ms
    await new Promise((r) => setTimeout(r, 900));
    const fading = a.volume;
    w.setSleep(null);
    await new Promise((r) => setTimeout(r, 4500));
    const res = { before, fading, after: a.volume, paused: a.paused };
    a.pause();
    return res;
  });
  if (got.fading >= got.before || got.paused || Math.abs(got.after - got.before) > 0.01) throw new Error(JSON.stringify(got));
});

await step('a track whose file will not load: one fresh address, then the next track; and what never played is not counted as heard', async () => {
  // Found reading the code, 5.11.2026: an address that failed asked for a new one for ever (605 asks
  // in 30 s, the player stuck on that track), and a track that never started went to History, to the
  // log and to the repeat filter as heard to its end.
  const got = await page.evaluate(async () => {
    const w = window.__wave;
    const base = 990000000 + Math.floor(Math.random() * 100000) * 10;
    const mk = (n) => ({ id: String(base + n), title: `e2e broken ${n}`, durationMs: 200000, artists: [], albums: [], available: true });
    const asked = [];
    const counted = (ids) => {
      const log = JSON.parse(w.storage.getItem('player.playlog.v1') || '{"plays":[]}').plays.filter((p) => ids.includes(p.id)).length;
      const recent = w.recentPlays.list().filter((p) => ids.includes(String(p.track.id))).length;
      const filter = JSON.parse(w.storage.getItem('wave.history.v1') || '{}');
      return { log, recent, filter: ids.filter((i) => filter[i]).length };
    };
    const run = async (first, stream) => {
      asked.length = 0;
      w.api.stream = async (id) => {
        asked.push(String(id));
        return stream(id);
      };
      const tracks = [mk(first), mk(first + 1), mk(first + 2)];
      void w.playTracks(tracks, 0, 'e2e broken');
      const seen = new Set();
      const until = performance.now() + 2600;
      while (performance.now() < until) {
        seen.add(w.usePlayer.getState().index);
        await new Promise((r) => setTimeout(r, 50));
      }
      const firstAsks = asked.filter((id) => id === tracks[0].id).length;
      return { firstAsks, moved: seen.has(1), counted: counted(tracks.map((t) => t.id)) };
    };
    // A real server's refusal of the file, at once.
    const noFile = await run(1, async () => ({ url: 'https://api.music.yandex.net/oni-no-such-file.mp3', codec: 'mp3', bitrate: 192 }));
    // Yandex gives no address at all.
    const refused = await run(4, async () => {
      throw new Error('refused');
    });
    return { noFile, refused };
  });
  await page.evaluate(() => {
    delete window.__wave.api.stream;
    window.__wave.audio.pause();
  });
  await page.evaluate(async () => {
    // Out of the stand-in those failures may have started: an ordinary list again.
    const t = (await window.__wave.api.chart()).find((x) => x.available !== false);
    await window.__wave.playTracks([t], 0, 'e2e after broken');
    window.__wave.audio.pause();
  });
  if (got.noFile.firstAsks > 2 || !got.noFile.moved) throw new Error(`no file: ${JSON.stringify(got.noFile)}`);
  for (const [what, r] of Object.entries(got)) if (r.counted.log || r.counted.recent || r.counted.filter) throw new Error(`${what} counted as heard: ${JSON.stringify(r)}`);
  if (!got.refused.moved) throw new Error(`refused: ${JSON.stringify(got.refused)}`);
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

await step('speed: the music goes 1.25× (both elements, the next track too), the pitch kept or not, back to 1× (reverted)', async () => {
  const state = () => page.evaluate(() => ({ rate: window.__wave.usePlayer.getState().rate, els: window.__wave.audio.elements.map((el) => ({ rate: el.playbackRate, pitch: el.preservesPitch })) }));
  try {
    await page.evaluate(async () => window.__wave.playTracks((await window.__wave.api.chart()).filter((t) => t.available !== false).slice(0, 3), 0, 'e2e speed'));
    await waitPlaying(1);
    await page.click('[data-testid="sound-button"]');
    await page.click('[data-testid="speed-1.25"]');
    let s = await state();
    if (s.rate !== 1.25 || s.els.some((el) => el.rate !== 1.25 || !el.pitch)) throw new Error(`1.25×: ${JSON.stringify(s)}`);
    // The clock of the track runs as fast: 2 s of the wall clock, about 2.5 s of the track.
    const t0 = await page.evaluate(() => [performance.now(), window.__wave.audio.currentTime]);
    await page.waitForTimeout(2000);
    const t1 = await page.evaluate(() => [performance.now(), window.__wave.audio.currentTime]);
    const pace = (t1[1] - t0[1]) / ((t1[0] - t0[0]) / 1000);
    if (pace < 1.1 || pace > 1.4) throw new Error(`the track goes ${pace.toFixed(2)}× the clock`);
    await page.locator('label', { has: page.locator('[data-testid="keep-pitch"]') }).click();
    s = await state();
    if (s.els.some((el) => el.pitch)) throw new Error(`pitch still kept: ${JSON.stringify(s)}`);
    // A new track (a new src resets an element's speed to its default one): still 1.25×.
    const index = await page.evaluate(() => window.__wave.usePlayer.getState().index);
    await page.keyboard.press('Escape');
    await page.click('[data-testid="next"]');
    await page.waitForFunction((i) => window.__wave.usePlayer.getState().index !== i, index, { timeout: 15000 });
    await waitPlaying(0.5);
    const el = await page.evaluate(() => window.__wave.audio.el.playbackRate);
    if (el !== 1.25) throw new Error(`the next track at ${el}×`);
    // The badge on the sound button, while it is not 1×.
    if ((await page.textContent('[data-testid="sound-button"]')) !== '1,25×') throw new Error(`badge "${await page.textContent('[data-testid="sound-button"]')}"`);
  } finally {
    await page.evaluate(() => {
      window.__wave.setRate(1, true);
      window.__wave.audio.pause();
    });
  }
  const s = await state();
  if (s.rate !== 1 || s.els.some((el) => el.rate !== 1 || !el.pitch)) throw new Error(`not back: ${JSON.stringify(s)}`);
  if (await page.$('.rate-badge')) throw new Error('the badge stayed at 1×');
});

await step('private listening: what plays reaches neither History, Recap nor the stats; History only if asked; the badge turns it off', async () => {
  const counts = () => page.evaluate(() => ({ recent: window.__wave.recentPlays.own().length, log: window.__wave.playLog.own().plays.length, stats: window.__wave.stats.summary(30).reduce((n, r) => n + r.plays, 0) }));
  /** Plays a chart track 6 s (past History's 5 s), then the next one: the play is done. */
  const listen = async (n) => {
    await page.evaluate(async (i) => window.__wave.playTracks((await window.__wave.api.chart()).filter((t) => t.available !== false).slice(i, i + 2), 0, 'e2e private'), n);
    await waitPlaying(6.5);
    await page.click('[data-testid="next"]');
    await page.waitForFunction(() => window.__wave.usePlayer.getState().index === 1, null, { timeout: 15000 });
    await page.evaluate(() => window.__wave.audio.pause());
  };
  try {
    await page.evaluate(() => window.__wave.navigate({ name: 'settings' }));
    await page.locator('label', { has: page.locator('[data-testid="private"]') }).click();
    await page.waitForSelector('[data-testid="private-badge"]');
    const before = await counts();
    await listen(10);
    const after = await counts();
    if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`private, yet counted: ${JSON.stringify({ before, after })}`);
    // "Keep it in Oni's History": History takes it, Recap and the stats still do not.
    await page.locator('label', { has: page.locator('[data-testid="private-history"]') }).click();
    await listen(12);
    const kept = await counts();
    if (kept.recent !== before.recent + 1 || kept.log !== before.log || kept.stats !== before.stats) throw new Error(`kept in History: ${JSON.stringify({ before, kept })}`);
    // The badge on the player bar turns it off.
    await page.click('[data-testid="private-badge"]');
    await page.waitForSelector('[data-testid="private-badge"]', { state: 'detached' });
    await listen(14);
    const open = await counts();
    if (open.recent !== kept.recent + 1 || open.log < kept.log || open.stats !== kept.stats + 1) throw new Error(`not counted again: ${JSON.stringify({ kept, open })}`);
  } finally {
    await page.evaluate(() => {
      window.__wave.setPrivacy({ on: false, keepHistory: false });
      window.__wave.audio.pause();
    });
  }
});
