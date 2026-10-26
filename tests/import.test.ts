// Offline tests for the playlist import (src/import): reading links, pages, lists and files, and
// telling whether a track Yandex found is the one asked for (cases from real playlists, 26.10.2026).
// Run: npm run test:import
import type { Track } from '../src/api/types.ts';
import { baseTitle, pick, queryOf, score } from '../src/import/match.ts';
import { fetchSource, ImportError, parseApple, parseSpotify, parseText, parseYoutubePage, sourceOf, type SourceTrack } from '../src/import/sources.ts';

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
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

test('links: the services, with their extras; anything else is text', () => {
  assert(sourceOf('https://open.spotify.com/playlist/37i9dQZF1DX5Ejj0EkURtP?si=abc')?.kind === 'spotify', 'spotify');
  assert(sourceOf('https://open.spotify.com/playlist/37i9dQZF1DX5Ejj0EkURtP')?.id === '37i9dQZF1DX5Ejj0EkURtP', 'spotify id');
  assert(sourceOf('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb')?.kind === 'apple', 'apple');
  assert(sourceOf('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')?.id === 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', 'youtube');
  assert(sourceOf('https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i')?.kind === 'youtube', 'youtube music');
  assert(sourceOf('https://m.youtube.com/watch?v=abc&list=PLxyz')?.id === 'PLxyz', 'a video in a playlist');
  assert(sourceOf('Кино — Группа крови') === null, 'text');
  assert(sourceOf('https://example.com/playlist/1') === null, 'another site');
});

test('a pasted list: dashes, "by", numbers and lengths, a title alone', () => {
  const l = parseText('1. Кино — Группа крови\nDaft Punk - One More Time (5:20)\n02) Bohemian Rhapsody by Queen\nБез исполнителя\n\n', 'Мой');
  assert(l.title === 'Мой' && l.tracks.length === 4, `${l.tracks.length} tracks`);
  assert(l.tracks[0].artists[0] === 'Кино' && l.tracks[0].title === 'Группа крови', JSON.stringify(l.tracks[0]));
  assert(l.tracks[1].title === 'One More Time' && l.tracks[1].durationMs === 320000, JSON.stringify(l.tracks[1]));
  assert(l.tracks[2].title === 'Bohemian Rhapsody' && l.tracks[2].artists[0] === 'Queen', JSON.stringify(l.tracks[2]));
  assert(l.tracks[3].title === 'Без исполнителя' && !l.tracks[3].artists.length, JSON.stringify(l.tracks[3]));
});

test("Exportify's CSV: quoted fields, several artists, the length", () => {
  const csv = '"Track URI","Track Name","Album Name","Artist Name(s)","Release Date","Duration (ms)"\n"spotify:track:1","Under Pressure - Remastered 2011","Hot Space","Queen,David Bowie","1982","248440"\n"spotify:track:2","Say ""Hi""","X","Someone","2000","1000"';
  const l = parseText(csv);
  assert(l.tracks.length === 2, `${l.tracks.length}`);
  assert(l.tracks[0].artists.join('|') === 'Queen|David Bowie' && l.tracks[0].durationMs === 248440, JSON.stringify(l.tracks[0]));
  assert(l.tracks[1].title === 'Say "Hi"', l.tracks[1].title);
});

test("Spotify's embed page", () => {
  const data = { props: { pageProps: { state: { data: { entity: { name: 'All Out 2010s', trackList: [{ title: 'Beauty And A Beat', subtitle: 'Justin Bieber, Nicki Minaj', duration: 227986 }] } } } } } };
  const l = parseSpotify(`<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`);
  assert(l.title === 'All Out 2010s' && l.tracks[0].artists.join('|') === 'Justin Bieber|Nicki Minaj' && !l.partial, JSON.stringify(l));
});

test("Apple Music's page", () => {
  const data = { data: [{ data: { sections: [{ itemKind: 'containerDetailHeaderLockup', items: [{ title: "Today's Hits", trackCount: 120 }] }, { itemKind: 'trackLockup', items: [{ title: 'Housewife', artistName: 'Tate McRae', duration: 208810 }] }] } }] };
  const l = parseApple(`<script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script>`);
  assert(l.title === "Today's Hits" && l.tracks[0].artists[0] === 'Tate McRae' && l.partial, JSON.stringify(l));
});

test("YouTube Music's page: title, artists, length, the list's own continuation", () => {
  const item = (name: string, by: string[], time: string) => ({
    musicResponsiveListItemRenderer: {
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: name }] } } }, { musicResponsiveListItemFlexColumnRenderer: { text: { runs: by.map((text) => ({ text })) } } }],
      fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: time }] } } }],
    },
  });
  const page = {
    header: { musicResponsiveHeaderRenderer: { title: { runs: [{ text: 'Top 100' }] } } },
    contents: [item('Dai Dai', ['Shakira', ' & ', 'Burna Boy'], '4:01'), { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'MORE' } } } }],
    suggestions: { continuations: [{ nextContinuationData: { continuation: 'OTHER' } }] },
  };
  const p = parseYoutubePage(page);
  assert(p.title === 'Top 100' && p.next === 'MORE', `${p.title} ${p.next}`);
  assert(p.tracks[0].artists.join('|') === 'Shakira|Burna Boy' && p.tracks[0].durationMs === 241000, JSON.stringify(p.tracks[0]));
});

// ------------------------------------------------------------ matching

const track = (title: string, artists: string[], seconds: number, version?: string): Track => ({ id: `${title}|${artists.join()}|${version ?? ''}`, title, version, artists: artists.map((name, i) => ({ id: i, name })), albums: [], durationMs: seconds * 1000 }) as Track;
const src = (artists: string[], title: string, seconds?: number): SourceTrack => ({ title, artists, durationMs: seconds ? seconds * 1000 : undefined });

test('titles lose what services add, not what the song is called', () => {
  assert(baseTitle('Under Pressure - Remastered 2011') === 'under pressure', baseTitle('Under Pressure - Remastered 2011'));
  assert(baseTitle('See You Again (feat. Kali Uchis)') === 'see you again', baseTitle('See You Again (feat. Kali Uchis)'));
  assert(baseTitle('Gimme Da Lite (Official Music Video)') === 'gimme da lite', baseTitle('Gimme Da Lite (Official Music Video)'));
  assert(baseTitle('Sunflower - Spider-Man: Into the Spider-Verse') === 'sunflower spider man into the spider verse', baseTitle('Sunflower - Spider-Man: Into the Spider-Verse'));
  assert(queryOf(src(['Tyler, The Creator'], 'See You Again (feat. Kali Uchis)')) === 'Tyler, The Creator See You Again', queryOf(src(['Tyler, The Creator'], 'See You Again (feat. Kali Uchis)')));
});

test('the same song is found: other case, accents, "feat." in the title, a second off', () => {
  const m = pick(src(['Måneskin'], "Beggin'", 212), [track('Beggin', ['Maneskin'], 211), track("Beggin'", ['DJ Vibrant'], 217, 'Tribute Version')]);
  assert(m.state === 'found' && m.candidates[0].track.artists[0].name === 'Maneskin', JSON.stringify(m.candidates.map((c) => [c.track.artists[0].name, c.score])));
  assert(pick(src(['Кино'], 'Группа крови'), [track('Группа крови', ['Кино'], 285)]).state === 'found', 'no length to go by');
});

test('another artist with the same title is not the song (a cover, a namesake)', () => {
  const m = pick(src(['One Direction'], 'Night Changes', 227), [track('Night Changes', ['Anna Vaus'], 226)]);
  assert(m.state === 'none', `${m.state} ${m.candidates[0]?.score}`);
  // "Tyler" of "Tyler, The Creator" split by the comma is not "Eddy Tyler"
  assert(pick(src(['Tyler', 'The Creator'], 'See You Again', 180), [track('See You Again', ['Eddy Tyler'], 225)]).state === 'none', 'Eddy Tyler');
  assert(pick(src(['Future'], 'California Girls', 150), [track('California Girls', ['Future Club Hitmakers'], 237)]).state === 'none', 'Future Club Hitmakers');
});

test('a version not asked for is not the song; the one asked for is', () => {
  assert(pick(src(['WALK THE MOON'], 'Shut Up and Dance', 199), [track('Shut Up and Dance', ['WALK THE MOON'], 100, 'Acoustic Piano')]).state === 'none', 'acoustic');
  const remix = pick(src(['Jung Kook', 'Usher'], 'Standing Next to You (Usher Remix)', 230), [track('Standing Next to You', ['Jung Kook']), track('Standing Next to You', ['Jung Kook', 'Usher'], 215, 'USHER Remix')].map((t, i) => (i ? t : ({ ...t, durationMs: 206000 }) as Track)));
  assert(remix.state === 'found' && remix.candidates[0].track.version === 'USHER Remix', JSON.stringify(remix.candidates.map((c) => [c.track.version, c.score])));
});

test("a video's length (YouTube) does not keep the song from being found; a far-off length elsewhere does", () => {
  assert(score(src(['Drake'], 'You Broke My Heart', 293), track('You Broke My Heart', ['Drake'], 231), true) >= 0.85, 'video');
  assert(score(src(['Drake'], 'You Broke My Heart', 293), track('You Broke My Heart', ['Drake'], 231)) < 0.85, 'a minute off in a Spotify list');
});

test('an unavailable track is left out; candidates come once', () => {
  const t = track('Song', ['A'], 200);
  const m = pick(src(['A'], 'Song', 200), [{ ...t, available: false } as Track, track('Song', ['A'], 201), track('Song', ['A'], 201)]);
  assert(m.candidates.length === 1 && m.candidates[0].track.durationMs === 201000, JSON.stringify(m.candidates.length));
});

// a service that never answers (YouTube in Russia without a VPN): given up, not waited for for ever
const never = () => new Promise<never>(() => {});
for (const link of ['https://www.youtube.com/playlist?list=PLx', 'https://open.spotify.com/playlist/abc']) {
  const started = Date.now();
  const why = await fetchSource(link, never, 200).then(
    () => 'answered',
    (e) => (e instanceof ImportError ? e.reason : String(e)),
  );
  test(`a service that does not answer is given up: ${link.split('/')[2]}`, () => assert(why === 'slow' && Date.now() - started < 2000, `${why} after ${Date.now() - started} ms`));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
