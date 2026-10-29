// AI-made music (src/recs/aiRule.ts): what slopless.art's answers about artists make of a track.
// Run: npm run test:ai
import type { Track } from '../src/api/types.ts';
import { aiTrack, fromAnswer, type AiArtist } from '../src/recs/aiRule.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.message || e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const track = (id: number, ...artists: number[]) => ({ id, title: 't', artists: artists.map((a) => ({ id: a, name: `a${a}` })) }) as unknown as Track;

// Real answers, 29.10.2026 (cut): Metallica, and "The Velvet Sundown" (an AI band).
const metallica = fromAnswer({ aiTracks: 0, totalTracks: 1474, aiTrackList: [], yandexAiTrackList: [] }, 0);
const velvet = fromAnswer({ aiTracks: 3, totalTracks: 6, aiTrackList: [{ id: 154484603 }, { id: 154402498 }, { id: 144674205 }], yandexAiTrackList: [{ id: 154484603 }] }, 0);
const mixed = fromAnswer({ aiTracks: 1, totalTracks: 40, aiTrackList: [{ id: 7 }] }, 0);
const known: Record<string, AiArtist> = { 3121: metallica, 24428459: velvet, 55: mixed };
const look = (id: string) => known[id];

test("an answer's two lists together, without repeats", () => {
  assert(velvet.tracks.length === 3 && velvet.ai === 3 && velvet.total === 6, JSON.stringify(velvet));
  assert(fromAnswer({}, 0).ai === 0 && fromAnswer({}, 0).tracks.length === 0, 'an empty answer is nothing AI');
});

test('a track found AI is AI; an AI band\'s other tracks are too (half or more of its tracks)', () => {
  assert(aiTrack(track(154484603, 24428459), look), 'found AI');
  assert(aiTrack(track(1, 24428459), look), 'an AI band, not checked one by one');
});

test('a human artist with one AI track: only that one', () => {
  assert(aiTrack(track(7, 55), look), 'the AI one');
  assert(!aiTrack(track(8, 55), look), 'another one');
  assert(!aiTrack(track(18855, 3121), look), 'Metallica');
});

test('any of the artists counts; an artist not known yet says nothing', () => {
  assert(aiTrack(track(2, 999, 24428459), look), 'a feat. with an AI band');
  assert(!aiTrack(track(3, 999), look), 'unknown');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
