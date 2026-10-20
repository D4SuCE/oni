// Integration test against the real Yandex Music API using YANDEX_MUSIC_TOKEN.
// Every write is reverted: like→unlike, dislike→undislike, temp playlist is deleted.
// Run: npm run test:api
import type { HttpRequest, Transport } from '../src/api/transport.ts';
import { YandexMusic, trackKey } from '../src/api/yandex.ts';

const token = process.env.YANDEX_MUSIC_TOKEN;
if (!token) throw new Error('YANDEX_MUSIC_TOKEN is not set');

// Mirrors electron/main.cjs request() so the shared client is exercised as-is.
const nodeTransport: Transport = {
  platform: 'node',
  async request(req: HttpRequest) {
    const url = new URL(req.url);
    for (const [k, v] of Object.entries(req.query || {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { ...(req.headers || {}) };
    if (url.hostname.endsWith('music.yandex.net')) {
      headers.Authorization = `OAuth ${token}`;
      headers['X-Yandex-Music-Client'] ??= 'YandexMusicAndroid/24023621';
    }
    let body: any;
    if (req.form) body = new URLSearchParams(Object.entries(req.form).map(([k, v]) => [k, String(v)]));
    else if (req.json !== undefined) {
      body = JSON.stringify(req.json);
      headers['Content-Type'] = 'application/json';
    } else if (req.multipart) {
      body = new FormData();
      body.set(req.multipart.field, new Blob([req.multipart.data], { type: req.multipart.contentType }), req.multipart.filename);
    }
    const resp = await fetch(url, { method: req.method || (body ? 'POST' : 'GET'), headers, body });
    const text = await resp.text();
    let data: any = text;
    if (req.responseType !== 'text') {
      try {
        data = JSON.parse(text);
      } catch {}
    }
    return { status: resp.status, ok: resp.ok, data };
  },
  hasToken: async () => true,
  setToken: async () => {},
};

const ym = new YandexMusic(nodeTransport);
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

let sample: any;

await test('account', async () => {
  const a = await ym.account();
  assert(a.uid > 0, 'uid missing');
  assert(a.hasPlus, 'no Plus subscription — full tracks will not play');
});

await test('search', async () => {
  const r = await ym.search('Кино Группа крови');
  assert(r.tracks?.results.length, 'no tracks');
  assert(r.artists?.results.length, 'no artists');
  sample = r.tracks!.results[0];
});

await test('tracks by key', async () => {
  const [t] = await ym.tracks([trackKey(sample)]);
  assert(t.id === sample.id, 'wrong track');
});

await test('album with tracks', async () => {
  const a = await ym.album(sample.albums[0].id);
  assert(a.volumes?.[0]?.length, 'no album tracks');
});

await test('artist brief info + tracks', async () => {
  const a = await ym.artist(sample.artists[0].id);
  assert(a.artist.name && a.popularTracks.length, 'empty artist');
  assert((await ym.artistTracks(sample.artists[0].id)).length, 'no artist tracks');
});

await test('similar tracks', async () => {
  const s = await ym.similarTracks(sample.id);
  assert(Array.isArray(s), 'similar is not an array');
});

await test('chart + new releases', async () => {
  assert((await ym.chart()).length > 10, 'chart empty');
  assert((await ym.newReleases(6)).length > 0, 'new releases empty');
});

await test('stream url plays (range request)', async () => {
  const s = await ym.stream(sample.id);
  assert(s.url.startsWith('https://'), 'bad url');
  const r = await fetch(s.url, { headers: { Range: 'bytes=0-4095' } });
  assert(r.status === 206 || r.status === 200, `stream HTTP ${r.status}`);
  console.log(`       codec=${s.codec} bitrate=${s.bitrate}`);
});

await test('lyrics endpoint accepts signature', async () => {
  // Most tracks currently have no lyrics; lyrics() returns null on 404 and throws on a bad signature (403).
  const l = await ym.lyrics(sample.id);
  console.log(`       lyrics: ${l ? (l.synced ? 'synced' : 'text') + `, ${l.text.length} chars` : 'none for this track'}`);
});

await test('library reads', async () => {
  const liked = await ym.likedTrackKeys();
  assert(Array.isArray(liked), 'likes');
  await ym.dislikedTrackIds();
  await ym.likedAlbums();
  await ym.likedArtists();
  assert((await ym.playlists()).length >= 0, 'playlists');
});

await test('like / unlike (reverted)', async () => {
  const before = new Set((await ym.likedTrackKeys()).map((k) => k.split(':')[0]));
  const target = (await ym.chart()).find((t) => !before.has(t.id))!;
  await ym.setLiked([trackKey(target)], true);
  const mid = (await ym.likedTrackKeys()).map((k) => k.split(':')[0]);
  await ym.setLiked([trackKey(target)], false);
  assert(mid.includes(target.id), 'like not applied');
  const after = (await ym.likedTrackKeys()).map((k) => k.split(':')[0]);
  assert(!after.includes(target.id), 'unlike not applied');
});

await test('dislike / undislike (reverted)', async () => {
  const before = new Set(await ym.dislikedTrackIds());
  const target = (await ym.chart()).find((t) => !before.has(t.id))!;
  await ym.setDisliked([trackKey(target)], true);
  const mid = await ym.dislikedTrackIds();
  await ym.setDisliked([trackKey(target)], false);
  assert(mid.includes(target.id), 'dislike not applied');
  assert(!(await ym.dislikedTrackIds()).includes(target.id), 'undislike not applied');
});

await test('playlist create / add / remove / rename / delete', async () => {
  let pl = await ym.createPlaylist('Wave test (удалится)');
  try {
    pl = await ym.addToPlaylist(pl, [sample]);
    const full = await ym.playlist(pl.uid, pl.kind);
    assert(full.trackCount === 1 && full.tracks?.[0]?.track?.id === sample.id, 'track not added');
    pl = await ym.removeFromPlaylist(full, 0);
    assert(pl.trackCount === 0, 'track not removed');
    pl = await ym.renamePlaylist(pl.kind, 'Wave test 2');
    assert(pl.title === 'Wave test 2', 'rename failed');
  } finally {
    await ym.deletePlaylist(pl.kind);
  }
  assert(!(await ym.playlists()).some((p) => p.kind === pl.kind), 'playlist not deleted');
});

await test('wave: contexts, start, more, radioStarted feedback', async () => {
  const ctx = await ym.waveContexts();
  assert(ctx.length > 0, 'no contexts');
  const b = await ym.waveStart(['user:onyourwave', 'settingDiversity:discover', 'settingMoodEnergy:calm']);
  assert(b.items.length > 0, 'empty wave');
  await ym.waveFeedback(b.sessionId, b.batchId, 'radioStarted');
  const more = await ym.waveMore(b.sessionId, b.items.map((i) => trackKey(i.track)));
  assert(more.items.length > 0, 'no more tracks');
});

if (process.env.WAVE_TEST_UPLOAD) {
  await test('upload mp3 into playlist', async () => {
    const fs = await import('node:fs');
    const path = process.env.WAVE_TEST_UPLOAD!;
    const pl = (await ym.playlists()).find((p) => p.title === 'MyMp3Uploads');
    assert(pl, 'playlist MyMp3Uploads not found');
    const buf = fs.readFileSync(path);
    const id = await ym.upload({ name: path.split(/[\\/]/).pop()!, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, pl);
    console.log(`       ugc-track-id=${id}`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
