// Offline unit tests for the anti-repeat wave engine (fake Yandex, fake clock).
// Run: npm run test:wave
import type { Track, WaveBatch } from '../src/api/types.ts';
import { DEFAULT_TUNING, WaveEngine, waveSeeds, type WaveApi, type WaveTuning } from '../src/wave/engine.ts';
import { ListenHistory } from '../src/wave/history.ts';

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

const mkTrack = (i: number, artist = i % 10): Track => ({
  id: String(1000 + i),
  title: `Track ${i}`,
  artists: [{ id: artist, name: `Artist ${artist}` }],
  albums: [{ id: 50 + i, title: 'A', artists: [] }],
  available: true,
});

/** A "Yandex" that keeps recycling a small pool, like the real wave does. */
function fakeYandex(pool: Track[], batchSize = 5) {
  let cursor = 0;
  const calls = { start: 0, more: 0, feedback: [] as string[] };
  const batch = (): WaveBatch => {
    const items = Array.from({ length: batchSize }, () => ({ track: pool[cursor++ % pool.length], liked: false }));
    return { sessionId: 's1', batchId: `b${cursor}`, items };
  };
  const api: WaveApi = {
    async waveStart() {
      calls.start++;
      return batch();
    },
    async waveMore() {
      calls.more++;
      return batch();
    },
    async waveFeedback(_s, _b, type) {
      calls.feedback.push(type);
    },
  };
  return { api, calls };
}

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const DAY = 86_400_000;
const tuning = (over: Partial<WaveTuning> = {}): WaveTuning => ({ ...DEFAULT_TUNING, ...over });

await test('seeds reflect Yandex-side settings', async () => {
  assert(waveSeeds(DEFAULT_TUNING).join() === 'user:onyourwave', 'default seeds');
  const s = waveSeeds(tuning({ diversity: 'discover', mood: 'calm', language: 'not-russian', context: { type: 'activity', tag: 'workout', name: '' } }));
  assert(s.join() === 'activity:workout,settingDiversity:discover,settingMoodEnergy:calm,settingLanguage:not-russian', s.join());
});

await test('never repeats a track within one session even if Yandex does', async () => {
  const pool = Array.from({ length: 40 }, (_, i) => mkTrack(i));
  const { api } = fakeYandex(pool);
  const engine = new WaveEngine(api, new ListenHistory(memoryStore()), tuning({ artistGap: 0 }));
  const ids: string[] = [];
  for (let i = 0; i < 40; i++) ids.push((await engine.next())!.id);
  assert(new Set(ids).size === 40, `repeats inside session: ${ids.length - new Set(ids).size}`);
  assert(engine.stats.rejected.duplicate === 0, 'no duplicates expected yet');
});

await test('drops tracks heard within noRepeatDays, keeps older ones', async () => {
  let now = 100 * DAY;
  const history = new ListenHistory(memoryStore(), 'h', () => now);
  const pool = Array.from({ length: 20 }, (_, i) => mkTrack(i));
  // Heard tracks 0..9: 0..4 yesterday, 5..9 ten days ago.
  for (let i = 0; i < 10; i++) {
    now = (i < 5 ? 99 : 90) * DAY;
    history.record(pool[i], 200, true);
  }
  now = 100 * DAY;
  const { api } = fakeYandex(pool);
  const engine = new WaveEngine(api, history, tuning({ noRepeatDays: 7, artistGap: 0 }));
  const got = new Set<string>();
  for (let i = 0; i < 15; i++) got.add((await engine.next())!.id);
  for (let i = 0; i < 5; i++) assert(!got.has(pool[i].id), `recent track ${i} was played`);
  for (let i = 5; i < 10; i++) assert(got.has(pool[i].id), `old track ${i} should be allowed`);
  assert(engine.stats.rejected.recent === 5, `recent rejections ${engine.stats.rejected.recent}`);
});

await test('hides tracks skipped twice, keeps tracks skipped once', async () => {
  const history = new ListenHistory(memoryStore());
  const pool = Array.from({ length: 10 }, (_, i) => mkTrack(i));
  history.record(pool[0], 3, false);
  history.record(pool[0], 5, false);
  history.record(pool[1], 4, false);
  const { api } = fakeYandex(pool);
  const engine = new WaveEngine(api, history, tuning({ artistGap: 0 }));
  const got = new Set<string>();
  for (let i = 0; i < 9; i++) got.add((await engine.next())!.id);
  assert(!got.has(pool[0].id), 'twice-skipped track played');
  assert(got.has(pool[1].id), 'once-skipped track should still play');
});

await test('respects artist gap', async () => {
  // 3 artists only, pool big enough.
  const pool = Array.from({ length: 60 }, (_, i) => mkTrack(i, i % 4));
  const { api } = fakeYandex(pool);
  const engine = new WaveEngine(api, new ListenHistory(memoryStore()), tuning({ artistGap: 3 }));
  const artists: string[] = [];
  for (let i = 0; i < 20; i++) artists.push(String((await engine.next())!.artists[0].id));
  for (let i = 1; i < artists.length; i++) {
    const window = artists.slice(Math.max(0, i - 3), i);
    assert(!window.includes(artists[i]), `artist ${artists[i]} repeated within gap at #${i}: ${artists.join(',')}`);
  }
});

await test('onlyNew plays never-heard tracks and falls back to oldest when exhausted', async () => {
  let now = 10 * DAY;
  const history = new ListenHistory(memoryStore(), 'h', () => now);
  const pool = Array.from({ length: 6 }, (_, i) => mkTrack(i));
  for (let i = 0; i < 6; i++) {
    now = (i + 1) * DAY; // track 0 heard longest ago
    history.record(pool[i], 100, true);
  }
  now = 10 * DAY;
  const { api, calls } = fakeYandex(pool);
  const engine = new WaveEngine(api, history, tuning({ onlyNew: true, artistGap: 0 }));
  const t = await engine.next();
  assert(t, 'fallback must still return something');
  assert(t.id === pool[0].id, `fallback should pick oldest heard (got ${t.id})`);
  assert(calls.more > 0, 'should have tried fetching more first');
});

await test('disliked tracks never play', async () => {
  const pool = Array.from({ length: 10 }, (_, i) => mkTrack(i));
  const { api } = fakeYandex(pool);
  const engine = new WaveEngine(api, new ListenHistory(memoryStore()), tuning({ artistGap: 0 }), (id) => id === pool[2].id);
  const got = new Set<string>();
  for (let i = 0; i < 9; i++) got.add((await engine.next())!.id);
  assert(!got.has(pool[2].id), 'disliked track played');
});

await test('sends radioStarted and passes feedback through', async () => {
  const { api, calls } = fakeYandex([mkTrack(1), mkTrack(2)]);
  const engine = new WaveEngine(api, new ListenHistory(memoryStore()), tuning());
  const t = (await engine.next())!;
  engine.feedback('trackStarted', t);
  engine.feedback('skip', t, 3);
  await new Promise((r) => setTimeout(r, 0));
  assert(calls.feedback.join() === 'radioStarted,trackStarted,skip', calls.feedback.join());
});

await test('history persists across instances', async () => {
  const store = memoryStore();
  new ListenHistory(store).record(mkTrack(1), 100, true);
  const h2 = new ListenHistory(store);
  assert(h2.get(mkTrack(1).id)?.plays === 1, 'not persisted');
});

await test("plays on the account's other devices count for the repeat filter, once", async () => {
  const DAY = 86_400_000;
  let now = Date.parse('2026-10-21T12:00:00Z');
  const history = new ListenHistory(memoryStore(), 'h', () => now);
  const engine = new WaveEngine(fakeYandex([]).api, history, tuning({ noRepeatDays: 7 }));
  const id = (n: number) => String(mkTrack(n).id);
  history.record(mkTrack(1), 200, true); // heard here, today
  history.mergeRemote([
    { id: id(1), at: now - DAY }, // the same track yesterday elsewhere: nothing changes
    { id: id(2), at: now - 2 * DAY }, // heard on the PC two days ago
    { id: id(3), at: now - 9 * DAY }, // long enough ago
  ]);
  assert(engine.rejectReason(mkTrack(2)) === 'recent', 'a track from another device is a repeat');
  assert(engine.rejectReason(mkTrack(3)) === null, 'nine days ago passes a 7-day filter');
  assert(history.get(id(1))?.plays === 1 && history.daysSince(id(1)) === 0, 'own play kept as it was');
  history.mergeRemote([{ id: id(2), at: now - 2 * DAY }]);
  assert(history.get(id(2))?.plays === 1, 'merging the same history again counts nothing more');
  now += 6 * DAY;
  assert(engine.rejectReason(mkTrack(2)) === null, 'and it ages out like any play');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
