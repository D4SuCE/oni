// Offline unit tests for the play log behind "Recap" (src/player/playLog.ts): plays with their
// dates and minutes, other devices' days from Yandex merged once, the tops of a period.
// Run: npm run test:playlog
import type { Track } from '../src/api/types.ts';
import { PlayLog } from '../src/player/playLog.ts';

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

const artist = (id: number, name: string) => ({ id, name });
const track = (id: string, artists: { id: number; name: string }[], genre = 'rock', durationMs = 180_000): Track => ({
  id,
  title: `T${id}`,
  artists,
  albums: [{ id: 1, title: 'A', genre, artists: [] }],
  durationMs,
  available: true,
});
const memory = () => {
  const kv = new Map<string, string>();
  return { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
};
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const monthOf = (y: number, m: number) => ({ from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() });

const kino = artist(1, 'Кино');
const aria = artist(2, 'Ария');
const both = artist(3, 'Гость');

await test('recap: minutes, tops of tracks, artists and genres, only within the period', () => {
  const log = new PlayLog(memory(), () => at(2026, 10, 22));
  const a = track('a', [kino]);
  const b = track('b', [aria], 'metal');
  const c = track('c', [kino, both]);
  for (let i = 0; i < 3; i++) log.record(a, at(2026, 10, 2 + i), 180);
  log.record(b, at(2026, 10, 5), 120);
  log.record(c, at(2026, 10, 6), 60);
  log.record(b, at(2026, 9, 30), 180); // last month: not in October's
  const r = log.recap(monthOf(2026, 10));
  assert(r.plays === 5 && Math.round(r.minutes) === 12, `totals: ${r.plays} plays, ${r.minutes} min`);
  assert(r.tracks[0].track.id === 'a' && r.tracks[0].plays === 3 && r.tracks.length === 3, `tracks: ${r.tracks.map((t) => `${t.track.id}×${t.plays}`)}`);
  assert(r.artists[0].artist.name === 'Кино' && r.artists[0].plays === 4 && r.artists.length === 3, `artists: ${r.artists.map((x) => `${x.artist.name}×${x.plays}`)}`);
  assert(r.genres[0].genre === 'rock' && r.genres[0].plays === 4, `genres: ${JSON.stringify(r.genres)}`);
  assert(r.artistCount === 3 && r.trackCount === 3 && r.days === 5, `counts: ${r.artistCount} artists, ${r.trackCount} tracks, ${r.days} days`);
  const sept = log.recap(monthOf(2026, 9));
  assert(sept.plays === 1 && sept.tracks[0].track.id === 'b', 'September apart');
});

await test("other devices' days from Yandex: a track not heard here that day counts once, merging again adds nothing", () => {
  const log = new PlayLog(memory(), () => at(2026, 10, 22));
  const a = track('a', [kino]);
  const b = track('b', [aria]);
  log.record(a, at(2026, 10, 20, 9), 180);
  const days = [{ date: at(2026, 10, 20, 0), tracks: [a, b] }, { date: at(2026, 10, 21, 0), tracks: [a] }];
  log.mergeRemote(days);
  log.mergeRemote(days);
  const r = log.recap(monthOf(2026, 10));
  // a: here on the 20th (Yandex's 20th is the same play) + another device on the 21st; b: once.
  assert(r.plays === 3 && r.tracks.find((t) => t.track.id === 'a')?.plays === 2, `plays: ${r.plays}, ${r.tracks.map((t) => `${t.track.id}×${t.plays}`)}`);
  // Another device's play counts the track's length (what it played is not known).
  assert(Math.round(r.minutes) === 9, `minutes ${r.minutes}`);
});

await test('kept across a restart; plays older than ~13 months go; seeded from the recent plays once', () => {
  const store = memory();
  let now = at(2026, 10, 22);
  const log = new PlayLog(store, () => now);
  log.seed([
    { track: track('a', [kino]), at: at(2026, 10, 1) },
    { track: track('b', [aria]), at: at(2025, 1, 1) },
  ]);
  log.seed([{ track: track('c', [kino]), at: at(2026, 10, 2) }]);
  const again = new PlayLog(store, () => now);
  const r = again.recap({ from: 0, to: Infinity });
  assert(r.plays === 1 && r.tracks[0].track.id === 'a', `seeded once, old dropped: ${r.tracks.map((t) => t.track.id)}`);
  now = at(2027, 12, 1);
  again.record(track('d', [aria]), now, 200);
  const later = new PlayLog(store, () => now).recap({ from: 0, to: Infinity });
  assert(later.plays === 1 && later.tracks[0].track.id === 'd', `pruned: ${later.tracks.map((t) => t.track.id)}`);
});

await test('a play written as it plays: the same start again only updates its length', () => {
  const log = new PlayLog(memory(), () => Date.parse('2026-10-24T20:00:00'));
  const at = Date.parse('2026-10-24T19:00:00');
  const t = track('7', [artist(1, 'A')]);
  log.record(t, at, 30);
  log.record(t, at, 60);
  log.record(t, at, 185);
  log.record(t, at + 200_000, 40); // played again
  const r = log.recap({ from: at - 1, to: at + 86_400_000 });
  assert(r.plays === 2, `plays ${r.plays}`);
  assert(Math.round(r.minutes * 60) === 225, `seconds ${r.minutes * 60}`);
});

await test('"a year ago": the most played of the same days last year, none with fewer than five tracks', () => {
  let now = at(2027, 10, 25);
  const log = new PlayLog(memory(), () => now);
  const old = [0, 1, 2, 3, 4, 5].map((i) => track(`y${i}`, [kino]));
  for (const [i, t] of old.entries()) log.record(t, at(2026, 10, 23 + (i % 4)), 180);
  log.record(old[2], at(2026, 10, 24, 18), 180); // twice: first
  log.record(track('far', [aria]), at(2026, 10, 1), 180); // not these days
  log.record(track('now', [aria]), at(2027, 10, 24), 180); // this year
  const got = log.yearAgo().map((t) => t.id);
  assert(got.length === 6 && got[0] === 'y2' && !got.includes('far') && !got.includes('now'), JSON.stringify(got));
  now = at(2027, 12, 1);
  assert(log.yearAgo().length === 0, 'a card with nothing a year ago');
  now = at(2027, 10, 25);
  const few = new PlayLog(memory(), () => now);
  for (const t of old.slice(0, 4)) few.record(t, at(2026, 10, 25), 180);
  assert(few.yearAgo().length === 0, 'a card with four tracks');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
