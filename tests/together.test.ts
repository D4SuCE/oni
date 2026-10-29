// Offline unit tests for listening together (src/together/): the shared clock, the room's files
// merged, the correction, and the invitation links. Run: npm run test:together
import type { Track } from '../src/api/types.ts';
import { offsetOf, SharedClock, type Sample } from '../src/together/clock.ts';
import { Folders, linkId, writeMine } from '../src/together/disk.ts';
import { correction, GONE, newer, Room, SEEK, targetOf, windowOf, type MemberFile, type RoomState } from '../src/together/room.ts';
import { linkFrom, shareUrl } from '../src/ui/links.ts';
// @ts-expect-error the site's plain script has no types
import { route } from '../site/open.js';

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
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const track = (id: string, seconds = 200): Track => ({ id, title: `T${id}`, artists: [], albums: [], durationMs: seconds * 1000 });
const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(String(i + 1)));
const dev = (id: string) => ({ id, platform: 'electron' });

function state(over: Partial<RoomState> = {}): RoomState {
  return { rev: 1000, by: 'a', queue: tracks(3), index: 0, title: 'List', playing: true, position: 10, at: 1000, ...over };
}
function file(id: string, over: Partial<MemberFile> = {}): MemberFile {
  return { v: 1, room: 'room1', at: 5000, me: { device: dev(id), name: id.toUpperCase(), link: `link-${id}` }, state: null, known: [], ...over };
}

console.log('\nthe shared clock');

await test('the fastest answer gives the offset (half its trip)', () => {
  const samples: Sample[] = [
    { sent: 0, got: 400, told: 10_300 }, // slow: says +10,100
    { sent: 1000, got: 1020, told: 11_010 }, // fast: +10,000
    { sent: 2000, got: 2200, told: 12_000 },
  ];
  assert(offsetOf(samples) === 10_000, `offset ${offsetOf(samples)}`);
  assert(offsetOf([]) === null, 'none: null');
});

await test('a surer source wins; a less sure one does not, unless forced', () => {
  let local = 0;
  const c = new SharedClock(() => local);
  assert(!c.known, 'not known at first');
  c.learn([{ sent: 0, got: 100, told: 5_050 }]); // ±50
  assert(c.offset === 5_000 && c.error === 50, `${c.offset} ±${c.error}`);
  c.learn([{ sent: 0, got: 300, told: 9_150 }]); // ±150: worse, kept the old
  assert(c.offset === 5_000, 'a worse one is not taken');
  c.learn([{ sent: 0, got: 4, told: 5_102 }]); // ±2: the network's host
  assert(c.offset === 5_100 && c.error === 2, `better taken: ${c.offset}`);
  c.learn([{ sent: 0, got: 300, told: 7_150 }], true);
  assert(c.offset === 7_000, 'forced: taken');
  local = 1000;
  assert(c.now() === 8_000, `now ${c.now()}`);
});

console.log('\nwhat plays');

await test('the later state wins; at one moment the larger device id', () => {
  const a = state({ rev: 10, by: 'a' });
  const b = state({ rev: 11, by: 'a' });
  assert(newer(a, b) === b && newer(b, a) === b, 'later');
  const x = state({ rev: 10, by: 'x' });
  assert(newer(a, x) === x && newer(x, a) === x, 'same moment: larger id');
  assert(newer(null, a) === a && newer(a, null) === a, 'none');
});

await test('the place runs on while playing, stops at the end, stands while paused', () => {
  const s = state({ position: 10, at: 1000 });
  assert(near(targetOf(s, 3500), 12.5), `on: ${targetOf(s, 3500)}`);
  assert(targetOf(s, 1000 + 500_000) === 200, 'not past the end');
  assert(targetOf({ ...s, playing: false }, 9000) === 10, 'paused');
  assert(targetOf(s, 500) === 10, 'a moment before it: not back');
});

await test('the queue goes as a part around the track', () => {
  const q = tracks(200);
  const w = windowOf(q, 100);
  assert(w.queue.length === 64 && w.queue[w.index].id === '101', `${w.queue.length} ${w.queue[w.index].id}`);
  const start = windowOf(q, 1);
  assert(start.index === 1 && start.queue[0].id === '1', 'at the start');
});

await test('far off: a seek; a little: a nudge, closing until very near; near: nothing', () => {
  const far = correction(30, 31, false);
  assert(far.seek === 31 && far.rate === 1, `seek: ${JSON.stringify(far)}`);
  assert(correction(30, 30 + SEEK + 0.01, false).seek !== undefined, 'just past SEEK');
  const behind = correction(30, 30.2, false);
  assert(behind.seek === undefined && behind.rate > 1 && behind.rate <= 1.04, `behind: faster ${behind.rate}`);
  const ahead = correction(30.2, 30, false);
  assert(ahead.rate < 1 && ahead.rate >= 0.96, `ahead: slower ${ahead.rate}`);
  assert(correction(30, 30.02, false).rate === 1, 'within 20 ms: left alone');
  assert(correction(30, 30.02, true).rate > 1, 'being nudged: on until 15 ms');
  assert(correction(30, 30.01, true).rate === 1, 'there');
});

await test('a nudged device closes in on the place and stays there', () => {
  // A device 0.3 s behind, its correction run every half second as tick() does.
  let actual = 50;
  let target = 50.3;
  let nudging = false;
  for (let i = 0; i < 80; i++) {
    const c = correction(actual, target, nudging);
    assert(c.seek === undefined, 'no seek for 0.3 s');
    nudging = c.rate !== 1;
    actual += 0.5 * c.rate;
    target += 0.5;
  }
  assert(Math.abs(actual - target) < 0.02, `off by ${actual - target}`);
});

console.log('\nthe room');

await test('members come, the newest state among their files is the room\'s', () => {
  const room = new Room('room1', dev('me'));
  let r = room.receive(file('a', { state: state({ rev: 10 }) }));
  assert(r.state && r.members, 'first file: both');
  assert(room.current?.rev === 10, 'state taken');
  r = room.receive(file('b', { state: state({ rev: 5 }) }));
  assert(!r.state && r.members, 'an older state is not taken');
  r = room.receive(file('b', { at: 6000, state: state({ rev: 20, by: 'b', index: 2 }) }));
  assert(r.state && !r.members && room.current?.index === 2, 'newer: taken');
  assert(!room.receive(file('a', { at: 4000, state: state({ rev: 99 }) })).state, 'an older file of a member is not read');
  assert(!room.take(state({ rev: 20, by: 'b', index: 2 })), 'the same state again: nothing');
  assert(room.take(state({ rev: 21, by: 'me' })), 'a press here: the room\'s');
});

await test('another room\'s file and its own are left alone', () => {
  const room = new Room('room1', dev('me'));
  assert(!room.receive(file('a', { room: 'other', state: state() })).members, 'another room');
  assert(!room.receive(file('me', { state: state() })).members, 'its own');
});

await test('who is there: the left and the long silent are not', () => {
  const room = new Room('room1', dev('me'));
  room.receive(file('a', { at: 1000 }));
  room.receive(file('b', { at: 1000 }));
  room.receive(file('c', { at: 1000, left: true }));
  const ids = room.others(1000 + GONE - 1).map((f) => f.me.device.id);
  assert(ids.join() === 'a,b', `there: ${ids}`);
  assert(room.others(1000 + GONE + 1).length === 0, 'silent too long: gone');
});

await test('the leader: the one who started, else the smallest id', () => {
  const room = new Room('room1', dev('m'));
  room.receive(file('z', { host: true }));
  room.receive(file('a'));
  assert(room.leader(5000, false) === 'z', 'the one who started');
  assert(room.leader(5000, true) === 'm', 'this one started');
  const r2 = new Room('room1', dev('m'));
  r2.receive(file('z'));
  r2.receive(file('a'));
  assert(r2.leader(5000, false) === 'a', 'smallest id');
  assert(r2.leader(5000 + GONE + 1, false) === 'm', 'alone: this one');
});

await test('everyone known: through the others\' files, with their folders', () => {
  const room = new Room('room1', dev('me'));
  room.receive(file('host', { host: true, lan: { hosts: ['192.168.1.5'], port: 4000 }, known: [{ device: dev('far'), name: 'FAR', link: 'link-far' }, { device: dev('me'), name: 'ME' }] }));
  const people = room.people().map((m) => `${m.device.id}:${m.link}`).sort();
  assert(people.join() === 'far:link-far,host:link-host', `people: ${people}`);
  assert(room.lan()?.device === 'host' && room.lan()?.port === 4000, 'where the one who started listens');
});

console.log('\nfolders on Disk');

/** Public Disk folders in memory, read as Folders reads them (listing, a download link, the file). */
function fakePublic(folders: Record<string, Record<string, string>>) {
  const fetch = async (req: any): Promise<any> => {
    const id = String(req.query?.public_key ?? '').split('/d/')[1];
    if (req.url.endsWith('/public/resources')) {
      const items = Object.entries(folders[id] ?? {}).map(([name, text]) => ({ name, md5: text, modified: 'x' }));
      return { ok: true, status: 200, data: { _embedded: { items } } };
    }
    if (req.url.endsWith('/public/resources/download')) return { ok: true, status: 200, data: { href: `mem://${id}${req.query.path}` } };
    const [fid, name] = req.url.slice('mem://'.length).split('/');
    return { ok: true, status: 200, data: folders[fid][name] };
  };
  return fetch as any;
}

await test("two devices of one account share a folder: each its own file there, each reads the other's (the user, 29.10.2026: PC + iPhone stayed «Together · 1»)", async () => {
  // One account, one Disk app folder: the iPhone started, the PC joined by a link to that same folder.
  const shared: Record<string, string> = {};
  const disk = {
    async write(path: string, text: string) {
      shared[path.split('/')[1]] = text;
    },
  } as any;
  const phone = file('phone', { host: true, state: state() });
  const pc = file('pc');
  await writeMine(disk, phone);
  await writeMine(disk, pc);
  assert(Object.keys(shared).length === 2, `files: ${Object.keys(shared)}`);
  const fetch = fakePublic({ same: shared });
  const pcSees = await new Folders(fetch).poll('room1', ['same'], 'pc');
  assert(pcSees.length === 1 && pcSees[0].me.device.id === 'phone', `the PC read ${pcSees.map((f) => f.me.device.id)}`);
  const phoneSees = await new Folders(fetch).poll('room1', ['same'], 'phone');
  assert(phoneSees.length === 1 && phoneSees[0].me.device.id === 'pc', `the iPhone read ${phoneSees.map((f) => f.me.device.id)}`);
});

await test('a file not changed since it was read is not read again; another room\'s files are left alone', async () => {
  const folder: Record<string, string> = {};
  const disk = { async write(path: string, text: string) { folder[path.split('/')[1]] = text; } } as any;
  await writeMine(disk, file('a'));
  await writeMine(disk, file('b', { room: 'room2' }));
  const folders = new Folders(fakePublic({ f: folder }));
  assert((await folders.poll('room1', ['f'], 'me')).length === 1, 'first: read');
  assert((await folders.poll('room1', ['f'], 'me')).length === 0, 'unchanged: not again');
  await writeMine(disk, file('a', { at: 9999 }));
  assert((await folders.poll('room1', ['f'], 'me')).length === 1, 'changed: again');
});

console.log('\nlinks');

await test('an invitation goes there and back; bad ones are nothing', () => {
  const url = shareUrl({ kind: 'listen', room: 'abcdef0123456789', folder: 'Xy-12_ab' });
  assert(url === 'https://oni-music.github.io/#listen/abcdef0123456789/Xy-12_ab', url);
  const back = linkFrom(url);
  assert(back?.kind === 'listen' && back.room === 'abcdef0123456789' && back.folder === 'Xy-12_ab', JSON.stringify(back));
  const oni = linkFrom('oni://listen/abcdef0123456789/Xy-12_ab');
  assert(oni?.kind === 'listen', 'oni://');
  assert(linkFrom('oni://listen/short/Xy') === null, 'too short');
  assert(linkFrom('oni://listen/abcdef0123456789') === null, 'no folder');
});

await test('the site opens Oni for an invitation (no Yandex Music for it)', () => {
  const r = route('#listen/abcdef0123456789/Xy-12_ab');
  assert(r?.kind === 'listen' && r.oni === 'oni://listen/abcdef0123456789/Xy-12_ab' && r.yandex === null, JSON.stringify(r));
  assert(route('#listen/x/y') === null, 'bad');
});

await test('a Disk folder\'s link to its id', () => {
  assert(linkId('https://disk.yandex.ru/d/AbC-12_x') === 'AbC-12_x', 'disk.yandex.ru');
  assert(linkId('https://yadi.sk/d/AbC') === 'AbC', 'yadi.sk');
  assert(linkId('https://example.com') === null, 'other');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
