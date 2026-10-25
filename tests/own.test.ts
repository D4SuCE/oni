// Offline unit tests for «Своя волна» (src/wave/own.ts): its pools mixed by the mode's shares, no
// repeats, the artist gap, the session's learning (heard to the end → similar next; skipped early
// twice → the artist out), the rests (a favourite not again within 3 days), dislikes.
// Run: npm run test:own
import type { Track } from '../src/api/types.ts';
import type { Heard } from '../src/recs/personal.ts';
import type { Like } from '../src/recs/smart.ts';
import { DEFAULT_TUNING } from '../src/wave/engine.ts';
import type { ListenHistory } from '../src/wave/history.ts';
import { OwnWave, type OwnMode, type OwnSources } from '../src/wave/own.ts';
import { seededRandom } from '../src/recs/util.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.stack || e}`);
  }
}
function assert(ok: unknown, what: string) {
  if (!ok) throw new Error(what);
}

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const track = (id: string, artist: string): Track => ({ id, title: id, artists: [{ id: artist, name: artist }], albums: [] }) as unknown as Track;

/** A library: 40 likes from 40 artists (the first 10 liked a year ago), 10 releases, each liked
 * track with 8 similar ones of their own artists; `quiet` says how long ago each was heard. */
function library(quiet: Record<string, number> = {}) {
  const likes: Like[] = Array.from({ length: 40 }, (_, i) => ({ track: track(`like${i}`, `la${i}`), at: NOW - (i < 10 ? 365 : 10) * DAY }));
  const heard: Heard[] = likes.slice(10, 20).map((l) => ({ track: l.track, plays: 5, last: NOW - 5 * DAY }));
  const similar = (t: Track) => Promise.resolve(Array.from({ length: 8 }, (_, k) => track(`sim-${t.id}-${k}`, `sa-${t.id}-${k % 4}`)));
  const releases = Array.from({ length: 10 }, (_, i) => track(`new${i}`, `na${i}`));
  const sources: OwnSources = { likes: async () => likes, heard: async () => heard, similar, releases: async () => releases };
  const history = { daysSince: (t: Track | string) => quiet[typeof t === 'string' ? t : String(t.id)] ?? Infinity } as unknown as ListenHistory;
  return { sources, history, likes };
}

async function station(mode: OwnMode = 'balanced', quiet: Record<string, number> = {}, disliked = new Set<string>()) {
  const { sources, history } = library(quiet);
  const wave = new OwnWave(sources, history, DEFAULT_TUNING, mode, (id) => disliked.has(id), seededRandom(`own:${mode}`), () => NOW);
  await wave.start();
  await new Promise((r) => setTimeout(r, 0)); // the releases come in their own time
  return wave;
}
const kind = (t: Track) => (String(t.id).startsWith('sim-') ? 'similar' : String(t.id).startsWith('new') ? 'fresh' : 'liked');

await test('each track once, and the same artist not within three tracks', async () => {
  const wave = await station();
  const seen = new Set<string>();
  const artists: string[] = [];
  for (let i = 0; i < 60; i++) {
    const t = await wave.next();
    assert(t, `ran dry at ${i}`);
    assert(!seen.has(String(t!.id)), `${t!.id} twice`);
    seen.add(String(t!.id));
    const a = String(t!.artists[0].id);
    assert(!artists.slice(-3).includes(a), `${a} again within 3 at ${i}`);
    artists.push(a);
  }
});

await test('the mode sets the share: familiar is mostly liked, new is mostly similar and fresh', async () => {
  const share = async (mode: OwnMode) => {
    const wave = await station(mode);
    const n = { liked: 0, similar: 0, fresh: 0 };
    for (let i = 0; i < 40; i++) n[kind((await wave.next())!)]++;
    return n;
  };
  const familiar = await share('familiar');
  const fresh = await share('fresh');
  assert(familiar.liked >= 24, `familiar: ${JSON.stringify(familiar)}`);
  assert(fresh.similar + fresh.fresh >= 28, `new: ${JSON.stringify(fresh)}`);
});

await test('heard to the end: its similar tracks come next; skipped early twice: its artist is out', async () => {
  const wave = await station('balanced');
  const first = (await wave.next())!;
  wave.feedback('trackFinished', first, 200);
  await new Promise((r) => setTimeout(r, 0));
  const next = [];
  for (let i = 0; i < 6; i++) next.push((await wave.next())!);
  assert(next.some((t) => String(t.id).startsWith(`sim-${first.id}-`)), `nothing like ${first.id} in ${next.map((t) => t.id)}`);

  // An artist skipped early twice is not offered again in the session.
  const victim = next.find((t) => kind(t) === 'similar') ?? next[0];
  const artist = String(victim.artists[0].id);
  wave.feedback('skip', victim, 5);
  wave.feedback('skip', victim, 8);
  for (let i = 0; i < 40; i++) {
    const t = await wave.next();
    if (!t) break;
    assert(String(t.artists[0].id) !== artist, `${artist} played after two early skips`);
  }
});

await test('a skip at 5 s takes the similar tracks it brought', async () => {
  const wave = await station('fresh');
  const t = (await wave.next())!;
  wave.feedback('trackFinished', t, 200);
  await new Promise((r) => setTimeout(r, 0));
  wave.feedback('skip', t, 5);
  for (let i = 0; i < 30; i++) {
    const x = await wave.next();
    if (!x) break;
    assert(!String(x.id).startsWith(`sim-${t.id}-`), `${x.id} came for a track skipped early`);
  }
});

await test('rests: a favourite heard 2 days ago waits, a forgotten hit comes, nothing heard today', async () => {
  const quiet: Record<string, number> = { like11: 2, like12: 0.2, like0: 50 };
  const wave = await station('familiar', quiet);
  const ids = new Set<string>();
  for (let i = 0; i < 80; i++) {
    const t = await wave.next();
    if (!t) break;
    ids.add(String(t.id));
  }
  assert(!ids.has('like11'), 'a favourite heard 2 days ago played');
  assert(!ids.has('like12'), 'a track heard today played');
  assert(ids.has('like0'), 'a forgotten hit (liked a year ago, quiet 50 days) never came');
});

await test('dislikes and the account\'s "Skipped" never play', async () => {
  const wave = await station('familiar', {}, new Set(['like15']));
  wave.isSkipped = (t) => t.id === 'like16';
  for (let i = 0; i < 80; i++) {
    const t = await wave.next();
    if (!t) break;
    assert(t.id !== 'like15' && t.id !== 'like16', `${t.id} played`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
