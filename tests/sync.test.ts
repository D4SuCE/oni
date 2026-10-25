// Offline unit tests for the shared history (src/sync/devices.ts): two devices, one fake Yandex
// Disk. Each sends only its own plays and reads the other's as a layer beside its own.
// Run: npm run test:sync
import type { Track } from '../src/api/types.ts';
import { PlayLog } from '../src/player/playLog.ts';
import { RecentPlays } from '../src/player/recent.ts';
import { DeviceSync } from '../src/sync/devices.ts';
import { RecsFeedback } from '../src/recs/feedback.ts';
import type { DiskLike } from '../src/sync/disk.ts';
import { ListenHistory } from '../src/wave/history.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.stack || e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** Yandex Disk's app folder in memory; counts the reads and writes. */
function fakeDisk() {
  const files = new Map<string, { text: string; modified: string }>();
  let clock = 0;
  const calls = { read: 0, write: 0 };
  const disk: DiskLike = {
    async list() {
      return [...files].map(([name, f]) => ({ name, modified: f.modified }));
    },
    async read(name) {
      calls.read++;
      const f = files.get(name);
      if (!f) throw new Error(`no ${name}`);
      return f.text;
    },
    async write(name, text) {
      calls.write++;
      files.set(name, { text, modified: `t${++clock}` });
    },
    async remove(name) {
      files.delete(name);
    },
  };
  return { disk, files, calls };
}

const DAY = 86_400_000;
const song = (id: number, title = `Song ${id}`, artist = 1): Track => ({
  id: String(id),
  title,
  artists: [{ id: artist, name: `Artist ${artist}` }],
  albums: [{ id: 1, title: 'A', genre: 'rock', artists: [] }],
  durationMs: 200_000,
  available: true,
});

function device(id: string, platform: string, disk: DiskLike, now: () => number) {
  const store = memoryStore();
  const history = new ListenHistory(store, 'h', now);
  const playLog = new PlayLog(store, now);
  const recent = new RecentPlays(store);
  const feedback = new RecsFeedback(store, now);
  const sync = new DeviceSync(disk, { history, playLog, recent, feedback }, { id, platform }, now);
  return { history, playLog, recent, feedback, sync, store };
}

/** As the app does it (sync/index.ts): read first, then send. */
async function send(d: { sync: DeviceSync }) {
  await d.sync.pull();
  return d.sync.push();
}

await test("a track heard on the phone is a repeat on the PC, Only new and the 7-day filter alike", async () => {
  let now = 100 * DAY;
  const { disk } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => now);
  const phone = device('phone', 'ios', disk, () => now);
  phone.history.record(song(1), 200, true);
  await send(phone);
  await pc.sync.pull();
  assert(pc.history.get('1')?.plays === 1, 'the phone’s play is known on the PC');
  assert(pc.history.of(song(2, 'Song 1'))?.plays === 1, 'and the same song under another id too');
  assert(pc.history.daysSince('1') === 0, 'heard today');
  now += 8 * DAY;
  assert(pc.history.daysSince('1') === 8, 'and it ages like the PC’s own');
});

await test('nothing of the other device is saved here or sent back', async () => {
  const { disk, files } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => DAY);
  const phone = device('phone', 'ios', disk, () => DAY);
  phone.history.record(song(1), 200, true);
  phone.recent.add({ track: song(1), at: DAY, source: 'Моя волна' });
  await send(phone);
  await pc.sync.pull();
  pc.history.record(song(2), 200, true);
  await pc.sync.push();
  const sent = JSON.parse(files.get('device-pc.json')!.text);
  assert(!sent.history['1'] && sent.history['2'], `PC sent ${Object.keys(sent.history)}`);
  assert(sent.recent.length === 0, 'PC sent the phone’s recent plays');
  assert(!pc.store.getItem('h')?.includes('"1"'), 'the phone’s play was saved on the PC');
});

await test('counts are not added up: the same play known to both (Yandex’s history) stays one', async () => {
  const { disk } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => 10 * DAY);
  const phone = device('phone', 'ios', disk, () => 10 * DAY);
  phone.history.record(song(1), 200, true);
  pc.history.mergeRemote([{ id: '1', at: 10 * DAY }]); // the PC heard of it from Yandex too
  await send(phone);
  await pc.sync.pull();
  assert(pc.history.get('1')?.plays === 1, `plays ${pc.history.get('1')?.plays}`);
});

await test('Recap counts the other device’s plays, as heard, instead of what Yandex’s history told', async () => {
  const day = Date.parse('2026-10-20T00:00:00');
  const { disk } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => day + DAY);
  const phone = device('phone', 'ios', disk, () => day + DAY);
  phone.playLog.record(song(1), day + 3600_000, 120); // two minutes of it on the phone
  phone.playLog.record(song(1), day + 7200_000, 200);
  pc.playLog.record(song(2), day + 3600_000, 200);
  pc.playLog.mergeRemote([{ date: day, tracks: [song(1)] }]); // Yandex: song 1 played elsewhere that day
  await send(phone);
  const before = pc.playLog.recap({ from: day, to: day + DAY });
  assert(before.plays === 2, `before: ${before.plays} plays`);
  await pc.sync.pull();
  const after = pc.playLog.recap({ from: day, to: day + DAY });
  assert(after.plays === 3, `after: ${after.plays} plays (the phone’s two, not Yandex’s one, and the PC’s)`);
  assert(Math.round(after.minutes * 60) === 520, `seconds ${after.minutes * 60}`);
  assert(after.tracks[0].track.title === 'Song 1', 'the phone’s track has its card');
});

await test('History “in this app” shows the other device’s plays among this one’s, with its name', async () => {
  const { disk } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => 0);
  const phone = device('phone', 'ios', disk, () => 0);
  pc.recent.add({ track: song(1), at: 1000, source: 'A' });
  phone.recent.add({ track: song(2), at: 2000, source: 'B' });
  await send(phone);
  await pc.sync.pull();
  const list = pc.recent.list();
  assert(list.length === 2 && list[0].track.id === '2' && list[0].device === 'ios' && !list[1].device, JSON.stringify(list.map((p) => [p.track.id, p.device])));
});

await test('unchanged, nothing goes up again; unchanged files are not read again', async () => {
  const { disk, calls } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => 0);
  const phone = device('phone', 'ios', disk, () => 0);
  phone.history.record(song(1), 200, true);
  assert((await send(phone)) && !(await phone.sync.push()), 'sent twice');
  await pc.sync.pull();
  await pc.sync.pull();
  assert(calls.read === 1, `read ${calls.read} times`);
  phone.history.record(song(2), 200, true);
  await send(phone);
  await pc.sync.pull();
  assert(calls.read === 2 && pc.history.get('2'), 'a changed file is read again');
});

await test('a broken file or one of a later Oni is left alone; a device gone from Disk leaves this one', async () => {
  const { disk, files } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => 0);
  const phone = device('phone', 'ios', disk, () => 0);
  files.set('device-broken.json', { text: '{"v":1,', modified: 'x' });
  files.set('device-future.json', { text: JSON.stringify({ v: 2, device: { id: 'future', platform: 'ios' } }), modified: 'x' });
  phone.history.record(song(1), 200, true);
  await send(phone);
  await pc.sync.pull();
  assert(pc.sync.devices().length === 1 && pc.history.get('1'), `devices ${JSON.stringify(pc.sync.devices())}`);
  files.delete('device-phone.json');
  await pc.sync.pull();
  assert(pc.sync.devices().length === 0 && !pc.history.get('1'), 'the phone is still here');
});

await test('disconnected, the other devices leave', async () => {
  const { disk } = fakeDisk();
  const pc = device('pc', 'electron', disk, () => 0);
  const phone = device('phone', 'ios', disk, () => 0);
  phone.history.record(song(1), 200, true);
  await send(phone);
  await pc.sync.pull();
  pc.sync.clear();
  assert(!pc.history.get('1') && pc.recent.list().length === 0, 'still there');
});

await test("a device that lost its own plays here gets them back from its file on Disk, and never sends less over it", async () => {
  // The user, 25.10.2026: ~60 tracks heard on the phone at night were gone from History in the
  // morning, everywhere: the phone's storage did not keep them, Oni started anew and sent its older
  // history over the file on Disk that had them.
  let now = 100 * DAY;
  const { disk, files } = fakeDisk();
  const night = device('phone', 'ios', disk, () => now);
  for (let i = 1; i <= 60; i++) {
    now += 200_000;
    const t = song(i);
    night.recent.add({ track: t, at: now, source: 'My Wave' });
    night.playLog.record(t, now, 190);
    night.history.record(t, 190, true);
  }
  await night.sync.pull();
  await night.sync.push();
  // Morning: the same phone, its storage without the night (a fresh store), opened again.
  now += DAY / 3;
  const morning = device('phone', 'ios', disk, () => now);
  morning.recent.add({ track: song(99), at: now, source: 'My Wave' });
  // A send before anything was read from Disk sends nothing (it would be less than the file there).
  await morning.sync.push();
  const kept = JSON.parse(files.get('device-phone.json')!.text);
  assert(kept.recent.length === 60, `sent before reading: ${kept.recent.length} on Disk`);
  await morning.sync.pull();
  assert(morning.recent.own().length === 61 && morning.recent.own()[0].track.id === '99', `recent: ${morning.recent.own().length}, newest ${morning.recent.own()[0]?.track.id}`);
  assert(morning.playLog.own().plays.length === 60, `log: ${morning.playLog.own().plays.length}`);
  assert(morning.history.get('30')?.plays === 1, `history: ${JSON.stringify(morning.history.get('30'))}`);
  // Kept here now, and on Disk with the new one; read again, nothing doubles.
  await morning.sync.push();
  assert(JSON.parse(files.get('device-phone.json')!.text).recent.length === 61, 'not sent with the night');
  await morning.sync.pull();
  assert(morning.recent.own().length === 61 && morning.playLog.own().plays.length === 60 && morning.history.get('30')?.plays === 1, 'doubled on a second read');
  const stored = JSON.parse(morning.store.getItem('player.recent.v1') || '[]');
  assert(stored.length === 61, `stored here: ${stored.length}`);
});

await test('"Skipped" is one list on every device: hidden, left out and demoted go everywhere; "Back" on one brings it back on all, a third device (a Mac later) learns it all', async () => {
  // The user, 25.10.2026: the lists differed on the PC and the phone; "a Mac later is one more device".
  const { disk } = fakeDisk();
  let t = Date.parse('2026-10-25T12:00:00Z');
  const now = () => t;
  const pc = device('pc', 'electron', disk, now);
  const phone = device('phone', 'ios', disk, now);
  const round = async (...ds: ReturnType<typeof device>[]) => {
    for (const d of ds) await d.sync.pull();
    for (const d of ds) await d.sync.push();
    for (const d of ds) await d.sync.pull();
  };
  await round(pc, phone);
  // The PC hides one; the phone leaves one out (skipped twice) and demotes an artist (two in a row).
  pc.feedback.hide(song(1));
  t += 1000;
  phone.feedback.recordPlay(song(2, 'Two', 7), 'skipped', t);
  phone.feedback.recordPlay(song(2, 'Two', 7), 'skipped', t);
  await round(pc, phone);
  for (const [name, d] of [['pc', pc], ['phone', phone]] as const) {
    assert(d.feedback.isSkipped('1', t) && d.feedback.isSkipped('2', t) && d.feedback.isDemoted(7, t), `${name}: not everything there`);
    assert(d.feedback.skippedList(t).map((e) => e.track.title).join() === 'Song 1,Two', `${name} lists ${d.feedback.skippedList(t).map((e) => e.track.title)}`);
  }
  // "Back" on the phone for the PC's hidden track and the artist: back on the PC too, and not undone by the PC's older marks.
  t += 1000;
  phone.feedback.bringBack('1');
  phone.feedback.liftArtist(7);
  await round(pc, phone);
  await round(pc, phone);
  for (const [name, d] of [['pc', pc], ['phone', phone]] as const) {
    assert(!d.feedback.isSkipped('1', t) && !d.feedback.isDemoted(7, t) && d.feedback.isSkipped('2', t), `${name}: back not everywhere`);
  }
  // A third device: the same list, the same backs.
  const mac = device('mac', 'mac', disk, now);
  await round(mac, pc, phone);
  assert(mac.feedback.skippedList(t).map((e) => e.track.title).join() === 'Two' && !mac.feedback.isSkipped('1', t) && !mac.feedback.isDemoted(7, t), `mac: ${mac.feedback.skippedList(t).map((e) => e.track.title)}`);
  // "Bring all back" on the Mac: everywhere.
  t += 1000;
  mac.feedback.reset();
  await round(mac, pc, phone);
  await round(mac, pc, phone);
  for (const [name, d] of [['pc', pc], ['phone', phone], ['mac', mac]] as const) assert(!d.feedback.isSkipped('2', t) && !d.feedback.skippedList(t).length, `${name}: not all back`);
});

await test('decisions kept before the lists were shared come together on the first exchange; a decision made since wins over them', async () => {
  const { disk } = fakeDisk();
  let t = Date.parse('2026-10-26T12:00:00Z');
  const now = () => t;
  const pc = device('pc', 'electron', disk, now);
  const phone = device('phone', 'ios', disk, now);
  // As an older Oni left them: no marks.
  pc.store.setItem('recs.feedback.v1', JSON.stringify({ hidden: ['10'], artists: {}, tracks: {}, cards: { 10: song(10, 'Old PC') } }));
  phone.store.setItem('recs.feedback.v1', JSON.stringify({ hidden: [], artists: { 5: { name: 'Old artist', streak: 0, demotedUntil: t + 5 * DAY } }, tracks: { 11: { n: 2, until: t + 99 * DAY } }, cards: { 11: song(11, 'Old phone') } }));
  const pc2 = { ...pc, feedback: new RecsFeedback(pc.store, now) };
  const phone2 = { ...phone, feedback: new RecsFeedback(phone.store, now) };
  pc2.sync = new DeviceSync(disk, { history: pc.history, playLog: pc.playLog, recent: pc.recent, feedback: pc2.feedback }, { id: 'pc', platform: 'electron' }, now);
  phone2.sync = new DeviceSync(disk, { history: phone.history, playLog: phone.playLog, recent: phone.recent, feedback: phone2.feedback }, { id: 'phone', platform: 'ios' }, now);
  for (let i = 0; i < 2; i++) for (const d of [pc2, phone2]) { await d.sync.pull(); await d.sync.push(); await d.sync.pull(); }
  for (const d of [pc2, phone2]) {
    assert(d.feedback.skippedList(t).map((e) => e.track.title).join() === 'Old PC,Old phone' && d.feedback.isDemoted(5, t), `together: ${d.feedback.skippedList(t).map((e) => e.track.title)}`);
  }
  t += 1000;
  phone2.feedback.bringBack('10');
  for (let i = 0; i < 2; i++) for (const d of [pc2, phone2]) { await d.sync.pull(); await d.sync.push(); await d.sync.pull(); }
  assert(!pc2.feedback.isSkipped('10', t), 'the old hidden one not back on the PC');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
