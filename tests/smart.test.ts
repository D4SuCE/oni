// Offline unit tests for the smart playlists (src/recs/smart.ts): plain rules over the user's
// likes (with their dates), plays and artists.
// Run: npm run test:smart
import type { Album, Track } from '../src/api/types.ts';
import { differs, likedMonth, likedYearAgo, mostPlayed, myArtists, newFromArtists } from '../src/recs/smart.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
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
const now = Date.parse('2026-10-25T12:00:00Z');
const track = (id: string, artist = 'a', extra: Partial<Track> = {}): Track => ({ id, title: id, artists: [{ id: artist, name: artist }], albums: [], ...extra }) as unknown as Track;
const ids = (ts: Track[]) => ts.map((t) => t.id).join(',');
const like = (id: string, daysAgo: number, artist?: string) => ({ track: track(id, artist), at: now - daysAgo * DAY });
const none = new Set<string>();

test('liked this month: the last 30 days, newest first, without dislikes and the unavailable', () => {
  const likes = [like('old', 40), like('b', 10), like('a', 1), like('x', 5), { track: track('gone', 'a', { available: false }), at: now - DAY }];
  assert(ids(likedMonth(likes, new Set(['x']), now)) === 'a,b', ids(likedMonth(likes, new Set(['x']), now)));
});

test('liked a year ago: these weeks a year ago, in the order they were liked', () => {
  const likes = [like('late', 350), like('early', 380), like('near', 360), like('far', 400), like('recent', 20)];
  assert(ids(likedYearAgo(likes, none, now)) === 'early,near,late', ids(likedYearAgo(likes, none, now)));
});

test('"most played" shows only when more than half of it is not "on repeat"', () => {
  const list = (n: string) => n.split('').map((id) => track(id));
  assert(!differs(list('abcd'), list('abcx')), 'three of four the same, yet shown');
  assert(!differs(list('abcd'), list('abxy')), 'half the same, yet shown');
  assert(differs(list('abcd'), list('axyz')), 'three of four new, yet hidden');
  assert(differs(list('ab'), []), 'no "on repeat", yet hidden');
});

test('most played: three plays or more, the most first, the latest among equals', () => {
  const heard = [
    { track: track('two'), plays: 2, last: now },
    { track: track('five'), plays: 5, last: now - DAY },
    { track: track('three-old'), plays: 3, last: now - 9 * DAY },
    { track: track('three-new'), plays: 3, last: now - DAY },
  ];
  assert(ids(mostPlayed(heard, none)) === 'five,three-new,three-old', ids(mostPlayed(heard, none)));
});

test('my artists: followed first, then by likes and plays, various artists left out', () => {
  const likes = [like('1', 1, 'liked'), like('2', 2, 'liked'), like('3', 3, 'other')];
  const heard = [{ track: track('4', 'played'), plays: 30, last: now }];
  const various = { track: { ...track('5'), artists: [{ id: 'va', name: 'Various', various: true }] } as unknown as Track, at: now };
  assert(myArtists([...likes, various], heard, [{ id: 'f' }]).join(',') === 'f,played,liked,other', myArtists([...likes, various], heard, [{ id: 'f' }]).join(','));
  assert(myArtists(likes, heard, [], 2).length === 2, 'past the limit');
});

test('new from my artists: whole releases of the last 30 days, newest first, each track once', () => {
  const album = (id: number, daysAgo: number) => ({ id, title: String(id), releaseDate: new Date(now - daysAgo * DAY).toISOString() }) as unknown as Album;
  const releases = [
    { album: album(1, 20), tracks: [track('1a'), track('1b')] },
    { album: album(2, 2), tracks: [track('2a'), track('1a'), track('2b')] },
    { album: album(3, 60), tracks: [track('3a')] },
    { album: album(4, -3), tracks: [track('future')] },
  ];
  assert(ids(newFromArtists(releases, new Set(['2b']), now)) === '2a,1a,1b', ids(newFromArtists(releases, new Set(['2b']), now)));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
