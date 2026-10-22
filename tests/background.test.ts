// Offline unit tests for the iPhone's background downloads (src/player/backgroundDownloads.ts):
// a fake iOS session and folder, a fake library.
// Run: npm run test:background
import type { Track } from '../src/api/types.ts';
import { BackgroundDownloads, type BackgroundDeps } from '../src/player/backgroundDownloads.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
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

const track = (id: string, extra: Partial<Track> = {}) => ({ id, title: `t${id}`, artists: [], albums: [], ...extra }) as unknown as Track;

function setup(opts: { streamFails?: Set<string> } = {}) {
  const kv = new Map<string, string>();
  const ios = new Map<string, string>(); // id → url, what iOS works on
  const folder = new Map<string, ArrayBuffer>(); // finished files
  const kept = new Map<string, ArrayBuffer>();
  const sealedFolder = new Map<string, number>(); // id → size, sealed natively
  const taken = new Map<string, number>();
  const sent: string[][] = [];
  let resolves = 0;
  const deps: BackgroundDeps = {
    native: {
      enqueue: async (items) => {
        sent.push(items.map((i) => i.id));
        for (const i of items) ios.set(i.id, i.url);
      },
      running: async () => [...ios.keys()],
      cancel: async (ids) => ids.forEach((id) => ios.delete(id)),
    },
    sealed: {
      list: async () => [...sealedFolder].map(([id, size]) => ({ id, size })),
      take: async (id, _t, size) => {
        sealedFolder.delete(id);
        taken.set(id, size);
      },
      remove: async (id) => void sealedFolder.delete(id),
    },
    incoming: {
      list: async () => [...folder.keys()],
      read: async (id) => folder.get(id)!,
      remove: async (id) => void folder.delete(id),
    },
    stream: async (id) => {
      resolves++;
      if (opts.streamFails?.has(id)) throw new Error('no network');
      return { url: `https://cdn.test/${id}?n=${resolves}`, codec: 'mp3', bitrate: 192 };
    },
    keep: async (t, audio) => void kept.set(String(t.id), audio),
    has: (id) => kept.has(id) || taken.has(id),
    store: { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) },
  };
  /** iOS finishes one: the file lands, the task is gone. */
  const finish = (id: string) => {
    ios.delete(id);
    folder.set(id, new TextEncoder().encode(`audio ${id}`).buffer);
  };
  /** iOS finishes one and the native side seals it (the page passed the key). */
  const finishSealed = (id: string, size = 100) => {
    ios.delete(id);
    sealedFolder.set(id, size);
  };
  return { bg: new BackgroundDownloads(deps), deps, ios, folder, kept, sent, kv, finish, finishSealed, sealedFolder, taken, resolves: () => resolves };
}

await test("a list goes to iOS in small chunks, in the list's order (top first, as Yandex's app), skipping what is there", async () => {
  const { bg, sent, kept } = setup();
  kept.set('3', new ArrayBuffer(1));
  const list = Array.from({ length: 9 }, (_, i) => track(String(i)));
  await bg.add('liked', list);
  assert(sent.length === 2 && sent[0].length === 6, `chunks ${sent.map((c) => c.length)}`);
  assert(sent.flat().join() === '0,1,2,4,5,6,7,8', `order ${sent.flat()}`);
  assert(bg.pendingFor('liked') === 8, `pending ${bg.pendingFor('liked')}`);
});

await test('finished files are sealed into the library and leave the folder', async () => {
  const { bg, kept, folder, finish } = setup();
  await bg.add('liked', [track('1'), track('2')]);
  finish('1');
  await bg.collect();
  assert(kept.has('1') && !kept.has('2') && !folder.size, 'kept one');
  assert(bg.pendingFor('liked') === 1, 'one to go');
});

await test('the books survive a restart, and a list written down but not yet sent goes on', async () => {
  const { bg, deps, sent, finish } = setup({ streamFails: new Set(['b']) });
  await bg.add('playlist:1:2', [track('a'), track('b')]);
  finish('a');
  const again = new BackgroundDownloads(deps); // the app was closed and opened again
  (deps.stream as any) = async (id: string) => ({ url: `https://cdn.test/${id}`, codec: 'mp3', bitrate: 192 });
  await again.resume();
  assert(again.pendingFor('playlist:1:2') === 1, 'a collected, b pending');
  assert(sent.flat().filter((id) => id === 'b').length === 1, `b sent once now: ${sent}`);
});

await test('what iOS dropped (an expired URL) is sent again with a fresh URL', async () => {
  const { bg, ios, sent } = setup();
  await bg.add('liked', [track('x')]);
  const first = ios.get('x');
  ios.delete('x'); // iOS gave up on it while the app was away
  await bg.resume();
  assert(sent.length === 2 && ios.get('x') !== first, `resent with a new URL: ${ios.get('x')} vs ${first}`);
});

await test('after a few failed hand-overs a track is given up and counted', async () => {
  const { bg, ios } = setup();
  await bg.add('liked', [track('y')]);
  for (let i = 0; i < 5; i++) {
    ios.delete('y');
    await bg.dropped('y');
  }
  assert(bg.pendingFor('liked') === 0 && bg.failed.liked === 1, `pending ${bg.pendingFor('liked')}, failed ${bg.failed.liked}`);
});

await test('no network: nothing is spun on, the list waits for the next resume', async () => {
  const { bg, resolves } = setup({ streamFails: new Set(['n1', 'n2']) });
  await bg.add('liked', [track('n1'), track('n2')]);
  assert(resolves() === 2 && bg.pendingFor('liked') === 2, `resolves ${resolves()}`);
});

await test('cancel: iOS stops, the list is forgotten', async () => {
  const { bg, ios } = setup();
  await bg.add('liked', [track('c1'), track('c2')]);
  await bg.add('album:5', [track('c3')]);
  await bg.cancel('liked');
  assert(bg.pendingFor('liked') === 0 && bg.pendingFor('album:5') === 1, 'only that list');
  assert(!ios.has('c1') && !ios.has('c2') && ios.has('c3'), 'cancelled in iOS');
});

await test('files sealed natively go into the library as they are; a cancelled one is deleted', async () => {
  const { bg, finishSealed, sealedFolder, taken, kept } = setup();
  await bg.add('liked', [track('1'), track('2')]);
  finishSealed('1', 4321);
  sealedFolder.set('77', 10); // of a list cancelled meanwhile
  await bg.collect();
  assert(taken.get('1') === 4321 && !kept.size, 'taken, not read and sealed again');
  assert(!sealedFolder.size && bg.pendingFor('liked') === 1 && !bg.isPending('1') && bg.isPending('2'), 'books');
});

await test('progress counts the lists as their buttons do, keeps finished ones to the end, a new list starts anew', async () => {
  const { bg, finishSealed, kept } = setup();
  kept.set('a', new ArrayBuffer(1)); // downloaded before
  await bg.add('liked', [track('a'), track('b'), track('c'), track('x', { available: false })], 'Мне нравится');
  let p = bg.progress();
  assert(p.done === 1 && p.total === 3 && p.title === 'Мне нравится', JSON.stringify(p));
  await bg.add('playlist:1:5', [track('d')], 'Rock');
  finishSealed('b');
  finishSealed('c');
  await bg.collect();
  p = bg.progress();
  assert(p.done === 3 && p.total === 4 && p.title === '', `two lists: ${JSON.stringify(p)}`);
  finishSealed('d');
  await bg.collect();
  p = bg.progress();
  assert(p.done === 4 && p.total === 4, `through: ${JSON.stringify(p)}`);
  await bg.add('album:9', [track('e'), track('f')], 'Album');
  p = bg.progress();
  assert(p.done === 0 && p.total === 2 && p.title === 'Album', `anew: ${JSON.stringify(p)}`);
});

await test('a cancelled list leaves the count: nothing left, nothing to show', async () => {
  // The user: after cancelling, the Dynamic Island kept the old numbers.
  const { bg } = setup();
  await bg.add('liked', [track('1'), track('2')], 'Liked');
  await bg.add('album:9', [track('3')], 'Album');
  await bg.cancel('album:9');
  let p = bg.progress();
  assert(p.total === 2 && p.title === 'Liked', `one left: ${JSON.stringify(p)}`);
  await bg.cancel('liked');
  p = bg.progress();
  assert(p.total === 0 && p.done === 0, `none left: ${JSON.stringify(p)}`);
});

await test('the count survives a restart', async () => {
  const { bg, deps } = setup();
  await bg.add('liked', [track('1'), track('2')], 'Liked');
  const again = new BackgroundDownloads(deps);
  const p = again.progress();
  assert(p.total === 2 && p.done === 0 && p.title === 'Liked', JSON.stringify(p));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
