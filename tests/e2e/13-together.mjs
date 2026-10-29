// e2e: listening together (src/together/, docs/together.md; part of tests/e2e.mjs). A stand-in friend:
// on the network, a WebSocket client as a friend's Oni would be; from afar, a folder of his own (here:
// one more open folder on the test Disk, removed after). The app is the real one, playing for real.
import { WebSocket } from 'ws';
import { page, step } from './harness.mjs';

const T = (fn, arg) => page.evaluate(fn, arg);
const hasDisk = () => T(() => Boolean(window.__wave.sync.useSync.getState().connected));
/** The room's moment now, on the app's shared clock (ms). */
const roomNow = () => T(() => window.__wave.together.now());
/** How far the app's audio is from where the room is now (s; + ahead). */
const offBy = () =>
  T(() => {
    const w = window.__wave;
    const s = w.together.state();
    if (!s?.playing) return null;
    const target = Math.min(s.position + (w.together.now() - s.at) / 1000, (s.queue[s.index].durationMs || 0) / 1000) + w.together.ahead();
    return w.audio.currentTime - target;
  });

/** A few tracks to play: what the earlier steps queued (alone, E2E_ONLY: found by a search). */
async function someTracks() {
  const tracks = await T(async () => {
    const q = window.__wave.usePlayer.getState().queue.filter((t) => t.available !== false && t.durationMs > 120_000);
    if (q.length >= 3) return q.slice(0, 6);
    const r = await window.__wave.api.search('Imagine Dragons');
    return (r.tracks?.results ?? []).filter((t) => t.available !== false && t.durationMs > 120_000).slice(0, 6);
  });
  if (tracks.length < 3) throw new Error(`only ${tracks.length} tracks queued`);
  return tracks.map((t) => ({ ...t }));
}

function guestFile(room, id, state, over = {}) {
  return { v: 1, room, at: state?.rev ?? Date.now(), me: { device: { id, platform: 'ios' }, name: `E2E ${id}` }, state, known: [], test: true, ...over };
}

await step('listening together: a friend on the network follows, is followed to 0.1 s, and his pause pauses here', async () => {
  if (!(await hasDisk())) return console.log('       skipped: no YANDEX_DISK_TOKEN');
  const tracks = await someTracks();
  await T((q) => window.__wave.playTracks(q, 0, 'E2E together'), tracks);
  await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.audio.currentTime > 1, null, { timeout: 30000 });
  await T(() => window.__wave.together.startTogether());
  await page.waitForFunction(() => window.__wave.together.useTogether.getState().room && window.__wave.together.lan(), null, { timeout: 20000 });
  const room = await T(() => window.__wave.together.useTogether.getState().room);
  const lan = await T(() => window.__wave.together.lan());
  const files = [];
  const ws = new WebSocket(`ws://${lan.hosts[0]}:${lan.port}`);
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.t === 'file') files.push(m.file);
  });
  try {
    await new Promise((ok, fail) => {
      ws.once('open', () => ws.send(JSON.stringify({ t: 'hello', key: room, device: { id: 'e2e-guest', platform: 'ios' } })));
      ws.once('message', (raw) => (String(raw).includes('"welcome"') ? ok() : fail(new Error(`no welcome: ${raw}`))));
      ws.once('error', fail);
      setTimeout(() => fail(new Error('no welcome in 5 s')), 5000);
    });
    // What the app plays came to the friend.
    const deadline = Date.now() + 5000;
    while (!files.some((f) => f.state) && Date.now() < deadline) await page.waitForTimeout(100);
    const host = files.findLast((f) => f.state);
    if (!host?.host || String(host.state.queue[host.state.index].id) !== String(tracks[0].id)) throw new Error(`the friend got ${JSON.stringify(host?.state?.queue?.[host?.state?.index]?.title)}`);

    // The friend starts the second track at 30 s: here too, and at the room's place.
    const now = await roomNow();
    const state = { rev: now, by: 'e2e-guest', queue: tracks, index: 1, title: 'E2E', playing: true, position: 30, at: now };
    ws.send(JSON.stringify({ t: 'file', file: guestFile(room, 'e2e-guest', state) }));
    await page.waitForFunction((id) => String(window.__wave.current()?.id) === id && !window.__wave.audio.paused, String(tracks[1].id), { timeout: 20000 });
    await page.waitForTimeout(5000);
    const offs = [];
    for (let i = 0; i < 6; i++) {
      offs.push(await offBy());
      await page.waitForTimeout(300);
    }
    console.log(`       off by ${offs.map((x) => (x * 1000).toFixed(0)).join(', ')} ms`);
    if (offs.some((x) => x === null || Math.abs(x) > 0.1)) throw new Error(`not in step: ${offs}`);

    // The friend pauses: here it pauses.
    const later = await roomNow();
    ws.send(JSON.stringify({ t: 'file', file: guestFile(room, 'e2e-guest', { ...state, rev: later, playing: false, position: 33, at: later }) }));
    await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 3000 });

    // A press here (Play) reaches the friend.
    files.length = 0;
    await page.click('[data-testid="play-toggle"]');
    const until = Date.now() + 3000;
    while (!files.some((f) => f.state?.playing) && Date.now() < until) await page.waitForTimeout(100);
    if (!files.some((f) => f.state?.playing)) throw new Error('Play here did not reach the friend');
    const people = await page.locator('[data-testid="together-badge"]').innerText();
    if (!/2/.test(people)) throw new Error(`badge: "${people}"`);
  } finally {
    ws.close();
    await T(() => window.__wave.together.leaveTogether());
  }
});

await step('listening together from afar: joined by a link through a friend\'s Disk folder, his pause comes, he hears this one', async () => {
  if (!(await hasDisk())) return console.log('       skipped: no YANDEX_DISK_TOKEN');
  const tracks = await someTracks();
  const folder = `together-e2e-${Date.now()}`;
  const room = `e2e${Date.now()}`;
  const put = (file) => T(([f, text]) => window.__wave.sync.disk.write(f, text), [`${folder}/room-${room}-e2e-far.json`, JSON.stringify(file)]);
  await T((f) => window.__wave.sync.disk.mkdir(f), folder);
  try {
    const link = await T((f) => window.__wave.sync.disk.publish(f), folder);
    const id = /\/d\/([\w-]+)/.exec(link)[1];
    let now = await roomNow();
    const state = { rev: now, by: 'e2e-far', queue: tracks, index: 2, title: 'E2E far', playing: true, position: 20, at: now };
    await put(guestFile(room, 'e2e-far', state, { host: true, me: { device: { id: 'e2e-far', platform: 'electron' }, name: 'E2E far', link: id } }));
    await T(([r, f]) => window.__wave.together.joinRoom(r, f), [room, id]);
    await page.waitForFunction((tid) => String(window.__wave.current()?.id) === tid && !window.__wave.audio.paused, String(tracks[2].id), { timeout: 30000 });
    const off = await (async () => (await page.waitForTimeout(4000), offBy()))();
    console.log(`       off by ${(off * 1000).toFixed(0)} ms`);
    if (Math.abs(off) > 0.15) throw new Error(`not in step: ${off}`);
    if (await T(() => window.__wave.together.useTogether.getState().heard)) throw new Error('heard before the friend knows this one');

    // The friend reads this one's folder (it says so in "known") and pauses.
    const mine = await T(() => window.__wave.together.useTogether.getState().link);
    if (!mine) throw new Error('this one has no folder');
    now = await roomNow();
    await put(guestFile(room, 'e2e-far', { ...state, rev: now, playing: false, position: 25, at: now }, {
      host: true,
      at: now,
      me: { device: { id: 'e2e-far', platform: 'electron' }, name: 'E2E far', link: id },
      known: [{ device: await T(() => window.__wave.sync.deviceSync.device), name: 'me', link: mine }],
    }));
    await page.waitForFunction(() => window.__wave.audio.paused && window.__wave.together.useTogether.getState().heard, null, { timeout: 20000 });
  } finally {
    await T(() => window.__wave.together.leaveTogether());
    await T((f) => window.__wave.sync.disk.remove(f), folder).catch(() => {});
  }
});

await step("listening together: one's own uploaded song goes to the room through one's Disk folder; the others wait for it, then play it from there", async () => {
  // The user, 29.10.2026: "can one queue an uploaded song?" Yandex gives it to its owner alone.
  if (!(await hasDisk())) return console.log('       skipped: no YANDEX_DISK_TOKEN');
  const upload = await T(async () => {
    const { api } = window.__wave;
    for (const p of await api.playlists()) {
      const full = await api.playlist(p.uid, p.kind);
      const t = (full.tracks ?? []).map((i) => i.track).find((x) => x?.trackSource === 'UGC');
      if (t) return t;
    }
    return null;
  });
  if (!upload) return console.log('       skipped: no uploads in the account');
  const tracks = await someTracks();
  await T((q) => window.__wave.playTracks(q, 0, 'E2E together upload'), [upload, ...tracks.slice(0, 2)]);
  await T(() => window.__wave.together.startTogether());
  const folder = await T(() => window.__wave.together.useTogether.getState().link);
  try {
    // At first the room waits for it; then its file is there and the room's track says where.
    const first = await T(() => window.__wave.together.state());
    if (!first) throw new Error('no state');
    await page.waitForFunction(() => {
      const s = window.__wave.together.state();
      return s && !s.wait?.length && s.queue[s.index].share;
    }, null, { timeout: 90000 });
    const s = await T(() => window.__wave.together.state());
    const share = s.queue[s.index].share;
    console.log(`       waited: ${first.wait?.length ? 'yes' : 'no (sent already)'}; from ${share.link} ${share.file}`);
    if (!share.link.endsWith(`/d/${folder}`) || share.file !== `${upload.id}.mp3`) throw new Error(JSON.stringify(share));
    // A friend gets it by the link, no sign-in: the Disk gives its address.
    const url = await T(([l, f]) => window.__wave.transport.request({ url: 'https://cloud-api.yandex.net/v1/disk/public/resources/download', query: { public_key: l, path: `/${f}` } }).then((r) => r.data?.href), [share.link, share.file]);
    if (!url) throw new Error('the Disk gives no address for it');
  } finally {
    await T(() => window.__wave.together.leaveTogether());
  }
});

await step("listening together on two devices of one account (one Disk folder): this one joins the other's room by a link to its own folder, and is seen there", async () => {
  // The user, 29.10.2026: started on the iPhone, opened the link on the PC — both stayed «Together · 1».
  if (!(await hasDisk())) return console.log('       skipped: no YANDEX_DISK_TOKEN');
  const tracks = await someTracks();
  const room = `e2esame${Date.now()}`;
  const phone = 'e2ephone';
  const name = `together/room-${room}-${phone}.json`;
  const link = await T(async () => {
    await window.__wave.sync.disk.mkdir('together');
    return /\/d\/([\w-]+)/.exec(await window.__wave.sync.disk.publish('together'))[1];
  });
  const put = (file) => T(([n, text]) => window.__wave.sync.disk.write(n, text), [name, JSON.stringify(file)]);
  try {
    let now = await roomNow();
    const state = { rev: now, by: phone, queue: tracks, index: 1, title: 'E2E same account', playing: true, position: 15, at: now };
    const me = { device: { id: phone, platform: 'ios' }, name: 'E2E phone', link };
    await put(guestFile(room, phone, state, { host: true, me }));
    await T(([r, f]) => window.__wave.together.joinRoom(r, f), [room, link]);
    await page.waitForFunction((tid) => String(window.__wave.current()?.id) === tid && !window.__wave.audio.paused, String(tracks[1].id), { timeout: 30000 });
    await page.waitForFunction(() => window.__wave.together.useTogether.getState().people.length === 1, null, { timeout: 10000 });
    // The phone's Oni reads this one's file in the same folder: it is there, its own, beside the phone's.
    const own = await T(() => window.__wave.sync.deviceSync.device.id);
    const mine = await T(([r, d]) => window.__wave.sync.disk.read(`together/room-${r}-${d}.json`).then((t) => JSON.parse(t)), [room, own]);
    if (mine.me.device.id !== own || mine.room !== room) throw new Error(`this one's file: ${JSON.stringify(mine.me)}`);
    const phones = await T((n) => window.__wave.sync.disk.read(n).then((t) => JSON.parse(t)), name);
    if (phones.me.device.id !== phone) throw new Error('the phone\'s file was overwritten');
    if (await T(() => window.__wave.sync.elsewhere.useElsewhere.getState().controlling)) throw new Error('made a remote while in the room');
  } finally {
    await T(() => window.__wave.together.leaveTogether());
    await T((n) => window.__wave.sync.disk.remove(n), name).catch(() => {});
  }
});
