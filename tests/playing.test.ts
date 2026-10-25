// Offline unit tests for "what plays where" and the remote (src/sync/playing.ts): two devices, one
// fake Yandex Disk. Run: npm run test:playing
import type { Track } from '../src/api/types.ts';
import type { DiskLike } from '../src/sync/disk.ts';
import { commandFileOf, isLive, LIVE, PlayingSync, positionOf, type NowPlaying } from '../src/sync/playing.ts';

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

/** Yandex Disk's app folder in memory. Like Disk, `modified` has whole seconds only: two writes in
 * one second differ by the hash alone. */
function fakeDisk(clock: { t: number }) {
  const files = new Map<string, { text: string; modified: string; md5: string }>();
  let n = 0;
  const disk: DiskLike = {
    async list() {
      return [...files].map(([name, f]) => ({ name, modified: f.modified, md5: f.md5 }));
    },
    async read(name) {
      const f = files.get(name);
      if (!f) throw new Error(`no ${name}`);
      return f.text;
    },
    async write(name, text) {
      files.set(name, { text, modified: new Date(Math.floor(clock.t / 1000) * 1000).toISOString(), md5: `h${++n}` });
    },
    async remove(name) {
      files.delete(name);
    },
  };
  return { disk, files };
}

const song = (id: number): Track => ({ id: String(id), title: `Song ${id}`, durationMs: 200_000, artists: [], albums: [] });
const state = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  queue: Array.from({ length: 100 }, (_, i) => song(i)),
  index: 50,
  offset: 0,
  title: 'Мне нравится',
  playing: true,
  position: 30,
  duration: 200,
  shuffle: false,
  repeat: 'off',
  ...over,
});

function pair() {
  const clock = { t: 1_000_000_000 };
  const { disk, files } = fakeDisk(clock);
  const now = () => clock.t;
  const pc = new PlayingSync(disk, { id: 'pc', platform: 'electron' }, now);
  const phone = new PlayingSync(disk, { id: 'phone', platform: 'ios' }, now);
  return { clock, files, disk, pc, phone };
}

await test('the other device reads what plays, with the time going on while it plays', async () => {
  const { clock, pc, phone } = pair();
  await pc.publish(state(), clock.t);
  const first = await phone.poll();
  assert(first.changed, 'not seen');
  const [f] = phone.others();
  assert(f.device.id === 'pc' && f.queue[f.index].id === '50', `track ${f.queue[f.index]?.id}`);
  clock.t += 10_000;
  assert(Math.abs(positionOf(f, clock.t) - 40) < 0.01, `position ${positionOf(f, clock.t)}`);
  assert(isLive(f, clock.t), 'not live');
  // Not renewed (Oni closed while playing): not live any more, and the time stops at the end.
  clock.t += LIVE;
  assert(!isLive(f, clock.t), 'still live');
  clock.t += 300_000;
  assert(positionOf(f, clock.t) === 200, `past the end: ${positionOf(f, clock.t)}`);
  assert(!(await phone.poll()).changed, 'unchanged file read as a change');
  // Its own file is not among the others.
  await phone.publish(state({ playing: false }), clock.t);
  assert((await phone.poll()).changed === false && phone.others().length === 1, 'own file read');
});

await test('only a part of a long queue goes up, and its place in the whole is kept', async () => {
  const { clock, pc, phone } = pair();
  await pc.publish(state({ index: 50 }), clock.t);
  await phone.poll();
  const [f] = phone.others();
  assert(f.queue.length < 60, `${f.queue.length} tracks`);
  assert(f.offset + f.index === 50 && f.queue[f.index].id === '50', `offset ${f.offset}, index ${f.index}`);
  // Near the start nothing is cut before it.
  await pc.publish(state({ index: 2 }), clock.t);
  await phone.poll();
  const [g] = phone.others();
  assert(g.offset === 0 && g.index === 2, `offset ${g.offset}, index ${g.index}`);
});

await test('a press reaches the target once, in order, even two in one second', async () => {
  const { clock, pc, phone } = pair();
  await pc.publish(state(), clock.t);
  await phone.poll();
  await phone.send('pc', 'next');
  await phone.send('pc', 'seek', [12]);
  const got = await pc.poll();
  assert(got.commands.map((c) => c.fn).join() === 'next,seek' && got.commands[1].args[0] === 12, JSON.stringify(got.commands));
  assert(got.watchers.join() === 'phone', `watchers: ${got.watchers}`);
  assert((await pc.poll()).commands.length === 0, 'acted on twice');
  clock.t += 3_000;
  await phone.send('pc', 'toggle');
  const again = await pc.poll();
  assert(again.commands.length === 1 && again.commands[0].fn === 'toggle', JSON.stringify(again.commands));
});

await test('presses left from long ago are not acted on when Oni opens', async () => {
  const { clock, disk, phone } = pair();
  await phone.send('pc', 'toggle');
  clock.t += 10 * 60_000;
  // The PC opens now and reads the same folder.
  const pc = new PlayingSync(disk, { id: 'pc', platform: 'electron' }, () => clock.t);
  const got = await pc.poll();
  assert(got.commands.length === 0, `acted on: ${JSON.stringify(got.commands)}`);
  assert(!got.watchers.length, 'watched by a remote gone long ago');
});

await test('a remote that looks on says so now and then, not on every look', async () => {
  const { clock, files, phone } = pair();
  assert(await phone.watch('pc'), 'not written at first');
  assert(files.has(commandFileOf('pc', 'phone')), 'no file');
  clock.t += 5_000;
  assert(!(await phone.watch('pc')), 'written again at once');
  clock.t += 20_000;
  assert(await phone.watch('pc'), 'not renewed');
});

await test('a remote let go says so: the target stops being watched at once', async () => {
  const { clock, pc, phone } = pair();
  await phone.watch('pc');
  assert((await pc.poll()).watchers.join() === 'phone', 'not watched');
  clock.t += 1_000;
  await phone.unwatch('pc');
  assert(!(await pc.poll()).watchers.length, 'still watched');
  // Back as its remote later: watched again.
  clock.t += 1_000;
  assert(await phone.watch('pc'), 'not written');
  assert((await pc.poll()).watchers.join() === 'phone', 'not watched again');
});

await test("a remote's own file says it plays nothing and whose remote it is", async () => {
  const { clock, pc, phone } = pair();
  await phone.publish({ ...state(), playing: false, remoteOf: 'pc' }, clock.t);
  await pc.poll();
  const [f] = pc.others();
  assert(f.remoteOf === 'pc' && !isLive(f, clock.t), JSON.stringify({ remoteOf: f.remoteOf, playing: f.playing }));
});

await test("a test run's device is seen by test runs only", async () => {
  const clock = { t: 1_000_000_000 };
  const { disk } = fakeDisk(clock);
  const e2e = new PlayingSync(disk, { id: 'e2e', platform: 'electron' }, () => clock.t, true);
  const user = new PlayingSync(disk, { id: 'phone', platform: 'ios' }, () => clock.t);
  const otherTest = new PlayingSync(disk, { id: 'e2e2', platform: 'ios' }, () => clock.t, true);
  await e2e.publish(state(), clock.t);
  await user.poll();
  await otherTest.poll();
  assert(user.others().length === 0, "the user's device took up a test run");
  assert(otherTest.others().length === 1, 'a test run did not see another');
});

await test('what came over the home network stays when an older file is read from Disk', async () => {
  const { clock, pc, phone } = pair();
  await pc.publish(state({ playing: true }), clock.t);
  await phone.poll();
  clock.t += 2_000;
  // The PC paused: over the link at once (its Disk file goes up later).
  const quick = pc.fileFor(state({ playing: false, position: 32 }), clock.t);
  assert(phone.receive(quick), 'not taken');
  assert(!phone.receive({ ...quick, at: quick.at - 1 }), 'an older one taken');
  const before = phone.others()[0];
  await phone.poll();
  assert(phone.others()[0] === before && !phone.others()[0].playing, 'the older Disk file came back over it');
});

await test('a press over the home network and the same through Disk are done once', async () => {
  const { pc, phone } = pair();
  const c = phone.press('pc', 'toggle');
  assert(pc.accept(c), 'not accepted');
  assert(!pc.accept(c), 'accepted twice');
  await phone.flush('pc');
  const got = await pc.poll();
  assert(got.commands.length === 0, `done again from Disk: ${JSON.stringify(got.commands)}`);
});

await test("where a PC listens is read from its file; a test run's is not for the user's devices", async () => {
  const clock = { t: 1_000_000_000 };
  const { disk } = fakeDisk(clock);
  const pc = new PlayingSync(disk, { id: 'pc', platform: 'electron' }, () => clock.t);
  const phone = new PlayingSync(disk, { id: 'phone', platform: 'ios' }, () => clock.t);
  const e2e = new PlayingSync(disk, { id: 'e2e', platform: 'electron' }, () => clock.t, true);
  await pc.publishLan({ v: 1, device: pc.device, hosts: ['192.168.0.100'], port: 50000, key: 'k' });
  await e2e.publishLan({ v: 1, device: e2e.device, hosts: ['127.0.0.1'], port: 50001, key: 'k', test: true });
  await phone.poll();
  const files = phone.lanFiles();
  assert(files.length === 1 && files[0].device.id === 'pc' && files[0].port === 50000 && files[0].at === clock.t, JSON.stringify(files));
  await pc.poll();
  assert(pc.lanFiles().length === 0, 'its own file read');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
