// Offline unit tests for downloaded tracks (src/player/offline.ts): in-memory files, a fake
// network and the real Web Crypto.
// Run: npm run test:offline
import type { Track } from '../src/api/types.ts';
import { audioType, OfflineLibrary, type OfflineDeps } from '../src/player/offline.ts';

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

const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, title: `T${id}`, artists: [{ id: 1, name: 'A' }], albums: [], available: true, ...extra });
/** A fake mp3: an ID3 header and some bytes that depend on the id. */
const audioOf = (id: string) => new TextEncoder().encode(`ID3 fake audio of track ${id} `.repeat(200)).buffer;

function setup(opts: { failFetch?: Set<string> } = {}) {
  const disk = new Map<string, Uint8Array>();
  const kv = new Map<string, string>();
  let fetches = 0;
  const deps: OfflineDeps = {
    files: {
      write: async (name, data) => void disk.set(name, new Uint8Array(data.slice(0))),
      read: async (name) => {
        const f = disk.get(name);
        if (!f) throw new Error(`no file ${name}`);
        return f.slice().buffer;
      },
      remove: async (name) => void disk.delete(name),
      list: async () => [...disk].map(([name, d]) => ({ name, size: d.length })),
    },
    fetchBytes: async (url) => {
      fetches++;
      const id = url.split('/').pop()!;
      if (opts.failFetch?.has(id)) throw new Error('network down');
      await new Promise((r) => setTimeout(r, 5));
      return audioOf(id);
    },
    stream: async (id) => ({ url: `https://cdn.test/${id}`, codec: 'mp3', bitrate: 192 }),
    store: { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => void kv.set(k, v) },
    crypto: globalThis.crypto,
  };
  return { lib: new OfflineLibrary(deps), deps, disk, kv, fetches: () => fetches };
}

await test('download: the file on disk is encrypted, and opens back to the exact audio', async () => {
  const { lib, disk } = setup();
  await lib.download(track('1'));
  assert(lib.has('1') && lib.entries().length === 1, 'indexed');
  const file = disk.get('1.oni')!;
  const text = new TextDecoder('latin1').decode(file);
  assert(!text.includes('ID3') && !text.includes('fake audio'), 'no plain audio on disk');
  const { blob, entry } = await lib.open('1');
  assert(blob.type === 'audio/mpeg' && entry.bitrate === 192, `type ${blob.type}`);
  const back = new Uint8Array(await blob.arrayBuffer());
  const want = new Uint8Array(audioOf('1'));
  assert(back.length === want.length && back.every((b, i) => b === want[i]), 'same bytes after decryption');
  assert(lib.totalSize() === file.length, 'size counted');
});

await test('download: asking twice while it runs fetches once', async () => {
  const { lib, fetches } = setup();
  await Promise.all([lib.download(track('2')), lib.download(track('2')), lib.download(track('2'))]);
  assert(fetches() === 1, `fetched ${fetches()} times`);
  await lib.download(track('2'));
  assert(fetches() === 1, 'already downloaded: no fetch');
});

await test('downloadAll: skips what is there and what is unavailable, counts failures, reports progress', async () => {
  const { lib } = setup({ failFetch: new Set(['5']) });
  await lib.download(track('3'));
  const seen: string[] = [];
  const failures = await lib.downloadAll([track('3'), track('4'), track('5'), track('6'), track('7', { available: false })], (d, n) => seen.push(`${d}/${n}`));
  assert(failures === 1, `failures ${failures}`);
  // Counted against the whole list, the part already there included: a resumed download
  // shows where it is, not a fresh start (the user took "1 of 495" for starting over).
  assert(seen.join() === '2/4,3/4,4/4', `progress ${seen}`);
  assert(['3', '4', '6'].every((id) => lib.has(id)) && !lib.has('5') && !lib.has('7'), 'what is downloaded');
});

await test('downloadAll: in the order given, and stops when asked', async () => {
  const { lib, deps } = setup();
  const order: string[] = [];
  const fetchBytes = deps.fetchBytes;
  deps.fetchBytes = async (url) => (order.push(url.split('/').pop()!), fetchBytes(url));
  let stop = false;
  const tracks = ['20', '21', '22', '23', '24'].map((id) => track(id));
  await lib.downloadAll(tracks, (done) => void (stop = done >= 2), 1, () => stop);
  assert(order.join() === '20,21', `fetched ${order}`);
  assert(lib.has('20') && lib.has('21') && !lib.has('22'), 'stopped after two');
});

await test('keep: audio fetched elsewhere (background downloads) is stored like a download', async () => {
  const { lib, disk, fetches } = setup();
  await lib.keep(track('30'), audioOf('30'), 'mp3', 192);
  assert(lib.has('30') && fetches() === 0, 'kept without a fetch');
  assert(!new TextDecoder('latin1').decode(disk.get('30.oni')!).includes('fake audio'), 'encrypted on disk');
  const back = new Uint8Array(await (await lib.open('30')).blob.arrayBuffer());
  assert(back.length === audioOf('30').byteLength, 'opens back');
});

await test('the key survives a restart: a new library opens old downloads', async () => {
  const { lib, deps } = setup();
  await lib.download(track('8'));
  const again = new OfflineLibrary(deps);
  const { blob } = await again.open('8');
  assert(blob.size === audioOf('8').byteLength, 'opened after restart');
});

await test('remove and removeAll delete the files too', async () => {
  const { lib, disk } = setup();
  await lib.downloadAll([track('9'), track('10'), track('11')]);
  await lib.remove('9');
  assert(!lib.has('9') && !disk.has('9.oni') && disk.size === 2, 'one removed');
  await lib.removeAll();
  assert(lib.entries().length === 0 && disk.size === 0, 'all removed');
});

await test('reconcile: forgets entries without a file, deletes files without an entry', async () => {
  const { lib, disk } = setup();
  await lib.downloadAll([track('12'), track('13')]);
  disk.delete('12.oni');
  disk.set('99.oni', new Uint8Array(10));
  let told = 0;
  lib.subscribe(() => told++);
  await lib.reconcile();
  assert(!lib.has('12') && lib.has('13') && !disk.has('99.oni') && told === 1, 'cleaned up');
});

await test('audio type by codec', () => {
  assert(audioType('mp3') === 'audio/mpeg' && audioType('aac-mp4') === 'audio/mp4' && audioType('flac-mp4') === 'audio/mp4' && audioType('he-aac') === 'audio/aac', 'types');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
