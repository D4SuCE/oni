// Offline unit tests for the recommendation modules (synthetic library, fixed clock).
// Run: npm run test:recs
import type { Album, Track } from '../src/api/types.ts';
import { assembleDaylist, inSlot, personalShare, playedInSlot, slotAt, topGenres } from '../src/recs/daylist.ts';
import { discoverSeeds, rankDiscoveries } from '../src/recs/discover.ts';
import { assembleMix, mixSeeds, planMixes } from '../src/recs/mixes.ts';
import { buildProfile, type GenreTree, type TasteInput } from '../src/recs/profile.ts';
import { becauseYouListened, forgottenFavourites, onRepeat, recentArtists } from '../src/recs/personal.ts';
import { radarArtists, radarTracks, recentReleases } from '../src/recs/radar.ts';
import { interleave, pickSuggestions } from '../src/recs/suggest.ts';
import { PlayStats } from '../src/player/stats.ts';
import { DAY, artistIds, dayKey, seededRandom, weekKey } from '../src/recs/util.ts';

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

const NOW = Date.UTC(2026, 9, 21, 12); // a Wednesday
const tree: GenreTree = {
  parent: { rap: 'rap', rusrap: 'rap', foreignrap: 'rap', pop: 'pop', japanesepop: 'pop', ruspop: 'pop', rock: 'rock', folk: 'folk' },
  title: { rap: 'Рэп', pop: 'Поп', japanesepop: 'J-pop', rock: 'Рок', folk: 'Фолк' },
};

let seq = 0;
const mk = (genre: string, artist: number | string, extra: Partial<Track> = {}): Track => ({
  id: String(++seq),
  title: `T${seq}`,
  artists: [{ id: artist, name: `A${artist}` }],
  albums: [{ id: 9000 + seq, title: 'Al', genre, artists: [] }],
  available: true,
  ...extra,
});

/** 40 rap, 25 J-pop, 10 Russian pop, 15 rock, 3 folk; artists repeat a little. */
function library() {
  seq = 0;
  const liked: Track[] = [];
  for (let i = 0; i < 40; i++) liked.push(mk(i % 3 ? 'rap' : 'foreignrap', 100 + (i % 18)));
  for (let i = 0; i < 25; i++) liked.push(mk('japanesepop', 200 + (i % 12)));
  for (let i = 0; i < 10; i++) liked.push(mk('ruspop', 300 + (i % 6)));
  for (let i = 0; i < 15; i++) liked.push(mk('rock', 400 + (i % 8)));
  for (let i = 0; i < 3; i++) liked.push(mk('folk', 500 + i));
  return liked;
}

const input = (liked: Track[], extra: Partial<TasteInput> = {}): TasteInput => ({ liked, heard: [], disliked: new Set(), now: NOW, ...extra });

await test('profile: newer likes weigh more, skips subtract, dislikes are dropped', () => {
  const liked = library();
  const skipped = liked[5];
  const p = buildProfile(
    input(liked, {
      heard: [{ track: skipped, plays: 0, skips: 3, last: NOW - DAY }],
      disliked: new Set([liked[6].id]),
    }),
    tree,
  );
  assert(p.tracks.get(liked[0].id)!.weight > p.tracks.get(liked[liked.length - 1].id)!.weight, 'newest like should outweigh oldest');
  assert(!p.tracks.has(skipped.id), 'a liked track skipped three times recently should drop out');
  assert(!p.tracks.has(liked[6].id), 'disliked track must not be in the profile');
  assert(p.genres.get('rap')! > p.genres.get('rock')!, 'rap should be the heavier genre');
});

await test('profile: listening on other devices decays with time', () => {
  const t = mk('rock', 1);
  const fresh = buildProfile(input([], { heard: [{ track: t, plays: 4, skips: 0, last: NOW }] }), tree).tracks.get(t.id)!.weight;
  const old = buildProfile(input([], { heard: [{ track: t, plays: 4, skips: 0, last: NOW - 60 * DAY }] }), tree).tracks.get(t.id)!.weight;
  assert(Math.abs(old - fresh / 4) < 1e-9, `60 days at a 30-day half-life should quarter the weight (${fresh} → ${old})`);
});

await test('mixes: genre clusters, a big sub-genre gets its own mix, tiny genres are left out', () => {
  const plans = planMixes(buildProfile(input(library()), tree), tree);
  const genres = plans.map((p) => p.genre);
  assert(genres[0] === 'rap', `heaviest cluster first, got ${genres}`);
  assert(genres.includes('japanesepop'), `J-pop (25 of 35 pop tracks) should be its own mix, got ${genres}`);
  assert(genres.includes('pop'), 'the rest of pop stays a mix of its own (10 tracks)');
  assert(!genres.includes('folk'), 'folk has only 3 tracks');
  assert(!genres.includes('foreignrap'), 'foreign rap is under 15 tracks and stays inside rap');
});

await test('mixes: ~70% familiar, new tracks fit the genre and are unheard, artists kept apart', () => {
  const liked = library();
  const profile = buildProfile(input(liked), tree);
  const plan = planMixes(profile, tree).find((p) => p.genre === 'rap')!;
  const likedIds = new Set(liked.map((t) => t.id));
  const heardYesterday = plan.tracks[0].track.id;
  const candidates = [
    ...Array.from({ length: 30 }, (_, i) => mk('rap', 600 + i)),
    ...Array.from({ length: 10 }, (_, i) => mk('rock', 700 + i)), // wrong genre
    liked[1], // already liked
  ];
  const recent = mk('rap', 799);
  candidates.push(recent);
  const mix = assembleMix(plan, candidates, {
    tree,
    liked: likedIds,
    disliked: new Set(),
    daysSinceHeard: (id) => (id === heardYesterday ? 0.5 : id === recent.id ? 3 : Infinity),
    rand: seededRandom('2026-10-21'),
  });
  const fresh = mix.filter((t) => !likedIds.has(t.id));
  // 39 familiar (40 rap minus yesterday's) and 30 good candidates: 30% of 50 new, the rest familiar.
  assert(mix.length === 50, `full mix expected, got ${mix.length}`);
  assert(fresh.length === 15, `30% new, got ${fresh.length}`);
  assert(fresh.every((t) => t.albums[0].genre === 'rap'), 'new tracks must stay in the genre');
  assert(!mix.some((t) => t.id === recent.id), 'a candidate heard 3 days ago is not new');
  assert(!mix.some((t) => t.id === heardYesterday), 'a familiar track heard yesterday waits');
  for (let i = 1; i < mix.length; i++) {
    const a = new Set(artistIds(mix[i]));
    assert(!artistIds(mix[i - 1]).some((x) => a.has(x)), `same artist back to back at ${i}`);
  }
});

await test('mixes: the same day gives the same mix, another day a different one', () => {
  const profile = buildProfile(input(library()), tree);
  const plan = planMixes(profile, tree)[0];
  const seeds = (day: string) => mixSeeds(plan, 6, seededRandom(day)).map((t) => t.id).join();
  assert(seeds('2026-10-21') === seeds('2026-10-21'), 'deterministic within a day');
  assert(seeds('2026-10-21') !== seeds('2026-10-22'), 'changes the next day');
});

await test('discoveries: votes from several seeds win, nothing heard or liked, one per artist', () => {
  const liked = library();
  const profile = buildProfile(input(liked), tree);
  const seeds = discoverSeeds(profile, 5, seededRandom('w'));
  const popular = mk('rock', 900);
  const sameArtist = mk('rock', 900);
  const heard = mk('rock', 901);
  const results = seeds.map((seed, i) => ({
    seed,
    similar: [popular, sameArtist, heard, liked[0], mk('rap', 910 + i), mk('pop', 920 + i)],
  }));
  const knownArtists = new Set(profile.artists.keys());
  const out = rankDiscoveries(results, { tree, liked: new Set(liked.map((t) => t.id)), disliked: new Set(), heard: (id) => id === heard.id, knownArtists }, 30);
  assert(out.some((t) => t.id === popular.id), 'the track every seed points to is in');
  assert(!out.some((t) => t.id === sameArtist.id), 'one track per artist');
  assert(!out.some((t) => t.id === heard.id), 'heard tracks are not discoveries');
  assert(!out.some((t) => t.id === liked[0].id), 'liked tracks are not discoveries');
  assert(out.length === 11, `1 + 5 rap + 5 pop expected, got ${out.length}`);
});

await test('discoveries: no genre takes more than its share', () => {
  const profile = buildProfile(input(library()), tree);
  const results = [{ seed: library()[0], similar: [...Array.from({ length: 20 }, (_, i) => mk('rap', 1000 + i)), ...Array.from({ length: 20 }, (_, i) => mk('rock', 1100 + i))] }];
  const out = rankDiscoveries(results, { tree, liked: new Set(), disliked: new Set(), heard: () => false, knownArtists: new Set() }, 10, 0.4);
  const rap = out.filter((t) => t.albums[0].genre === 'rap').length;
  assert(rap <= 4, `rap capped at 40% of 10, got ${rap}`);
  void profile;
});

await test('radar: recent releases only, a couple of tracks each, artist list capped', () => {
  const album = (id: number, daysAgo: number): Album => ({ id, title: `R${id}`, artists: [], releaseDate: new Date(NOW - daysAgo * DAY).toISOString() });
  const releases = recentReleases([album(1, 3), album(2, 40), album(3, 10), album(1, 3)], NOW, 28);
  assert(releases.map((a) => a.id).join() === '1,3', `newest first, old and duplicate dropped: ${releases.map((a) => a.id)}`);
  const tracks = radarTracks(
    releases.map((a) => ({ album: a, tracks: [mk('rock', a.id), mk('rock', a.id), mk('rock', a.id)] })),
    new Set(),
    2,
  );
  assert(tracks.length === 4, `2 per release, got ${tracks.length}`);
  const profile = buildProfile(input(library()), tree);
  const followed = Array.from({ length: 100 }, (_, i) => ({ id: 5000 + i, name: `F${i}` }));
  assert(radarArtists(profile, followed, 40).length === 40, 'at most 40 artists to query');
});

await test('calendar keys: weeks start on the given weekday', () => {
  const wed = new Date(2026, 9, 21, 12).getTime();
  assert(weekKey(wed, 1) === dayKey(new Date(2026, 9, 19).getTime()), 'Monday week of Wed 21 Oct starts on the 19th');
  assert(weekKey(wed, 5) === dayKey(new Date(2026, 9, 16).getTime()), 'Friday week of Wed 21 Oct starts on the 16th');
  assert(weekKey(new Date(2026, 9, 19, 0, 5).getTime(), 1) === dayKey(new Date(2026, 9, 19).getTime()), 'Monday itself starts its week');
});

await test('on repeat: most played lately, two plays minimum, old plays left out', () => {
  const [a, b, c, d] = [mk('rock', 1), mk('rock', 2), mk('rock', 3), mk('rock', 4)];
  const out = onRepeat(
    [
      { track: a, plays: 3, last: NOW - DAY },
      { track: b, plays: 9, last: NOW - 2 * DAY },
      { track: c, plays: 1, last: NOW },
      { track: d, plays: 20, last: NOW - 60 * DAY },
    ],
    new Set(),
    NOW,
  );
  assert(out.map((t) => t.id).join() === [b.id, a.id].join(), `got ${out.map((t) => t.title)}`);
});

await test('forgotten favourites: only what has been quiet for 45+ days', () => {
  const liked = library().slice(0, 20);
  const recent = new Set(liked.slice(0, 10).map((t) => t.id));
  const out = forgottenFavourites(liked, [], (id) => (recent.has(id) ? 3 : 90), new Set(), seededRandom('w'));
  assert(out.length === 10, `10 quiet tracks expected, got ${out.length}`);
  assert(!out.some((t) => recent.has(t.id)), 'a track heard 3 days ago is not forgotten');
});

await test('because you listened: the artists of the last week, new tracks by similar artists only', () => {
  const fav = mk('rock', 'fav');
  const artists = recentArtists(
    [
      { track: fav, plays: 5, last: NOW - DAY },
      { track: mk('rock', 'old'), plays: 50, last: NOW - 30 * DAY },
    ],
    NOW,
    3,
  );
  assert(artists.length === 1 && artists[0].id === 'fav', `only this week's artist, got ${JSON.stringify(artists)}`);
  const heard = mk('rock', 'sim1');
  const cands = [mk('rock', 'sim1'), mk('rock', 'sim1'), mk('rock', 'sim1'), heard, mk('rock', 'fav'), mk('rock', 'sim2')];
  const out = becauseYouListened(cands, { liked: new Set(), disliked: new Set(), heard: (id) => id === heard.id, exclude: new Set(['fav']) });
  assert(out.length === 3, `two of sim1 and one of sim2, got ${out.length}`);
  assert(!out.some((t) => artistIds(t).includes('fav')), 'the seed artist itself is left out');
  assert(!out.some((t) => t.id === heard.id), 'heard tracks are left out');
});

await test('smart shuffle: a suggestion after every three tracks, none already in the list', () => {
  const list = Array.from({ length: 9 }, (_, i) => mk('rock', 600 + i));
  const fresh = Array.from({ length: 5 }, (_, i) => mk('rock', 700 + i));
  const sameArtist = mk('rock', 700);
  const recent = mk('rock', 790);
  const picked = pickSuggestions([list[0], ...fresh, sameArtist, recent], list, { disliked: new Set(), daysSinceHeard: (id) => (id === recent.id ? 2 : Infinity) }, 3);
  assert(picked.length === 3, `3 asked, got ${picked.length}`);
  assert(!picked.some((t) => t.id === list[0].id || t.id === recent.id || t.id === sameArtist.id), 'no list tracks, no recent plays, one per artist');
  const out = interleave(list, picked);
  assert(out.length === 12, `9 + 3, got ${out.length}`);
  assert([3, 7, 11].every((i) => picked.includes(out[i])), 'suggestions sit after every third track');
});

await test('play stats: finished at 85%, skipped under 30 s, last 30 days only', () => {
  const m = new Map<string, string>();
  const stats = new PlayStats({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) });
  stats.record('mix', 200, 220, false, NOW); // 91%: finished
  stats.record('mix', 12, 220, false, NOW); // skipped
  stats.record('mix', 100, 220, false, NOW); // neither
  stats.record('wave', 0, 200, true, NOW); // ended: finished
  stats.record('wave', 5, 200, false, NOW - 40 * DAY); // too old
  const s = stats.summary(30, NOW);
  const mix = s.find((x) => x.origin === 'mix')!;
  assert(s[0].origin === 'mix' && mix.plays === 3, `mix first with 3 plays: ${JSON.stringify(s)}`);
  assert(Math.abs(mix.finished - 1 / 3) < 1e-9 && Math.abs(mix.skipped - 1 / 3) < 1e-9, `thirds: ${JSON.stringify(mix)}`);
  assert(s.find((x) => x.origin === 'wave')!.plays === 1, 'the 40-day-old wave play is out of the window');
});

// Daylist: local times, since parts of the day follow the user's clock.
const at = (day: number, hour: number, min = 0) => new Date(2026, 9, day, hour, min).getTime();
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

await test('daylist: parts of the day, including the one across midnight', () => {
  const cases: [number, string, string, string][] = [
    [at(21, 7), 'morning', '21 5:00', '21 11:00'],
    [at(21, 11), 'day', '21 11:00', '21 17:00'],
    [at(21, 18, 30), 'evening', '21 17:00', '21 21:00'],
    [at(21, 23, 30), 'night', '21 21:00', '22 1:00'],
    [at(22, 0, 30), 'night', '21 21:00', '22 1:00'],
    [at(22, 3), 'late', '22 1:00', '22 5:00'],
  ];
  for (const [when, slot, start, end] of cases) {
    const s = slotAt(when);
    assert(s.slot === slot && hm(s.start) === start && hm(s.end) === end, `${hm(when)}: ${s.slot} ${hm(s.start)}–${hm(s.end)}`);
  }
  assert(inSlot(0, 'night') && inSlot(22, 'night') && !inSlot(1, 'night') && inSlot(1, 'late'), 'night wraps midnight');
});

await test("daylist: the user's own tracks for the part of the day, most played first", () => {
  seq = 0;
  const [a, b, c, d, e] = [mk('rap', 1), mk('rock', 2), mk('pop', 3), mk('rap', 4), mk('rap', 5)];
  const now = at(21, 8);
  const plays = [
    { track: a, at: at(20, 7), source: 'x' },
    { track: a, at: at(19, 9), source: 'x' },
    { track: b, at: at(20, 6), source: 'x' },
    { track: c, at: at(20, 14), source: 'x' }, // afternoon
    { track: d, at: at(20, 8), source: 'x' }, // disliked
    { track: e, at: at(20, 8), source: 'x' }, // always skipped
    { track: b, at: now - 90 * DAY, source: 'x' }, // too old
  ];
  const own = playedInSlot(plays, 'morning', { now, disliked: new Set([d.id]), skipped: (id) => id === e.id });
  assert(own.map((x) => `${x.track.id}×${x.plays}`).join(' ') === `${a.id}×2 ${b.id}×1`, JSON.stringify(own.map((x) => [x.track.id, x.plays])));
});

await test('daylist: own share grows with the log, wave fills the rest, nothing twice', () => {
  seq = 0;
  const wave = Array.from({ length: 50 }, (_, i) => mk(i % 2 ? 'rap' : 'rock', 1000 + i));
  assert(personalShare(0) === 0 && personalShare(20) === 0.25 && personalShare(500) === 0.5, 'share 0 → 0.25 → capped at 0.5');

  const empty = assembleDaylist([], wave, { disliked: new Set(), rand: seededRandom('x') });
  assert(empty.length === 30 && empty.every((t) => wave.includes(t)), `no log: 30 wave tracks, got ${empty.length}`);

  const own = Array.from({ length: 30 }, (_, i) => ({ track: mk('folk', 2000 + i), plays: 4 }));
  const disliked = new Set([wave[0].id]);
  const mixed = assembleDaylist(own, [own[0].track, ...wave], { disliked, rand: seededRandom('x') });
  const mine = mixed.filter((t) => own.some((o) => o.track === t)).length;
  assert(mixed.length === 30 && mine === 15, `120 plays: 15 own of 30, got ${mine} of ${mixed.length}`);
  assert(new Set(mixed.map((t) => t.id)).size === 30 && !mixed.some((t) => disliked.has(t.id)), 'no duplicates, nothing disliked');
  assert(mixed.slice(0, 10).some((t) => own.some((o) => o.track === t)), 'own tracks are spread, not pushed to the end');

  assert(topGenres([mk('rap', 1), mk('rap', 2), mk('rock', 3), mk('pop', 4), mk('rock', 5), mk('rap', 6)]).join() === 'rap,rock', 'top genres');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
