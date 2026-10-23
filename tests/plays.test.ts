// Offline unit tests for the play reports that fill the account's history (YandexMusic.reportPlay):
// since October 2026 Yandex takes them only as POST /plays (JSON), as its own app sends them; the
// old /play-audio form answers "ok" and is dropped. Wave plays are reported too, with their session.
// Run: npm run test:plays
import type { HttpRequest, Transport } from '../src/api/transport.ts';
import type { Track } from '../src/api/types.ts';
import { heardSeconds, YandexMusic } from '../src/api/yandex.ts';

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

/** Answers like Yandex and keeps what was sent. */
function recorder() {
  const sent: HttpRequest[] = [];
  const transport: Transport = {
    platform: 'node',
    async request(req) {
      sent.push(req);
      if (req.url.endsWith('/account/status')) return { status: 200, ok: true, data: { result: { account: { uid: 42, login: 'me' }, plus: {} } } };
      return { status: 200, ok: true, data: { result: 'ok' } };
    },
    hasToken: async () => true,
    setToken: async () => {},
  };
  return { sent, api: new YandexMusic(transport) };
}

const track: Track = { id: '123', title: 'T', artists: [], albums: [{ id: 77, title: 'A', artists: [] }], durationMs: 200_000, available: true } as Track;
const startedAt = new Date('2026-10-23T01:00:00Z');

const playsOf = (sent: HttpRequest[]) => sent.filter((r) => r.url.endsWith('/plays'));

await test('a wave play goes to /plays with its session, as the official app sends it', async () => {
  const { sent, api } = recorder();
  await api.reportPlay({ track, playId: 'p1', startedAt, playedSeconds: 200, endSeconds: 200, wave: { sessionId: 's1', batchId: 'b1', seeds: ['user:onyourwave'] } });
  const req = playsOf(sent)[0];
  assert(req, `no /plays request: ${sent.map((r) => r.url)}`);
  assert(!sent.some((r) => r.url.endsWith('/play-audio')), 'the old /play-audio is still sent');
  assert(req.method === 'POST' && typeof req.query?.clientNow === 'string', `method/query: ${req.method} ${JSON.stringify(req.query)}`);
  const p = (req.json as any)?.plays?.[0];
  assert(p, `body: ${JSON.stringify(req.json)}`);
  assert(p.trackId === '123' && p.albumId === '77' && p.playId === 'p1', `ids: ${JSON.stringify(p)}`);
  assert(p.context === 'radio' && p.contextItem === 'user:onyourwave', `context: ${p.context} ${p.contextItem}`);
  assert(p.radioSessionId === 's1' && p.batchId === 'b1', `session: ${p.radioSessionId} ${p.batchId}`);
  assert(p.totalPlayedSeconds === 200 && p.endPositionSeconds === 200 && p.trackLengthSeconds === 200, `seconds: ${JSON.stringify(p)}`);
  assert(p.startTimestamp === startedAt.toISOString() && typeof p.timestamp === 'string' && typeof p.from === 'string', `times/from: ${JSON.stringify(p)}`);
});

await test('a playlist play names the playlist', async () => {
  const { sent, api } = recorder();
  await api.reportPlay({ track, playId: 'p2', startedAt, playedSeconds: 31.6, endSeconds: 40.2, playlist: '42:3' });
  const p = (playsOf(sent)[0]?.json as any)?.plays?.[0];
  assert(p?.context === 'playlist' && p.contextItem === '42:3' && p.playlistId === '42:3', `playlist: ${JSON.stringify(p)}`);
  assert(p.totalPlayedSeconds === 32 && p.endPositionSeconds === 40, `rounded: ${p.totalPlayedSeconds} ${p.endPositionSeconds}`);
  assert(p.radioSessionId === undefined, 'a list play has no wave session');
});

await test('an album play names the album; a list of no kind is "other"', async () => {
  const { sent, api } = recorder();
  await api.reportPlay({ track, playId: 'p3', startedAt, playedSeconds: 10, endSeconds: 10, album: 77 });
  await api.reportPlay({ track, playId: 'p4', startedAt, playedSeconds: 10, endSeconds: 10 });
  const [a, b] = playsOf(sent).map((r) => (r.json as any).plays[0]);
  assert(a.context === 'album' && a.contextItem === '77', `album: ${JSON.stringify(a)}`);
  assert(b.context === 'other', `other: ${JSON.stringify(b)}`);
});

await test('a track that played to its end counts whole, also when the crossfade took its last seconds', () => {
  // Yandex puts a play into the history only at ~95 % of the track (checked on the account: 90 % no,
  // 95 % yes). With a 5 s crossfade a 90 s track reported 85 s and never got there (the user).
  assert(heardSeconds(85, true, 90, 85) === 90, `crossfaded: ${heardSeconds(85, true, 90, 85)}`);
  assert(heardSeconds(180, true, 180, 180) === 180, 'played out');
  // Skipped: what was heard, no more.
  assert(heardSeconds(40, false, 180, 40) === 40, `skipped: ${heardSeconds(40, false, 180, 40)}`);
  // Seeked to near the end and let run out: the part not heard is not counted.
  assert(heardSeconds(20, true, 180, 178) === 22, `seeked: ${heardSeconds(20, true, 180, 178)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
