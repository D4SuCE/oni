// Offline unit tests for the volume levelling (src/player/loudness.ts): loud tracks down to the
// target, quiet ones up only while their peak stays clean, an album as one recording.
// Run: npm run test:loudness
import { albumLoudness, levellingGain, TARGET_LUFS } from '../src/player/loudness.ts';

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
const db = (gain: number) => 20 * Math.log10(gain);
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

test('unknown loudness is left as it is', () => {
  assert(levellingGain(undefined) === 1, 'no data');
  assert(levellingGain({ i: undefined as unknown as number, tp: 0 }) === 1, 'no i');
});

test('a loud track is turned down to the target', () => {
  assert(near(db(levellingGain({ i: -5, tp: 1.5 })), TARGET_LUFS + 5), 'not cut by 3 dB');
  assert(near(db(levellingGain({ i: 0, tp: 2 })), -8), 'not cut by 8 dB');
  assert(near(db(levellingGain({ i: 10, tp: 2 })), -12), 'cut past the floor');
});

test('a quiet track is raised only while its peak stays under −1 dBTP', () => {
  // Clair de Lune as Yandex has it: −22.5 LUFS, peak −2.7 → 1.7 dB of room.
  assert(near(db(levellingGain({ i: -22.55, tp: -2.7 })), 1.7), 'not raised by its headroom');
  // Plenty of room: up to the target.
  assert(near(db(levellingGain({ i: -11, tp: -6 })), 3), 'not raised to the target');
  // Peaks already at the ceiling or over: nothing.
  assert(levellingGain({ i: -14, tp: -0.3 }) === 1, 'raised into clipping');
  assert(levellingGain({ i: -14, tp: 1 }) === 1, 'turned down when quiet');
  // Never more than 6 dB.
  assert(near(db(levellingGain({ i: -30, tp: -20 })), 6), 'raised past the cap');
  // No peak known: not raised.
  assert(levellingGain({ i: -20, tp: undefined as unknown as number }) === 1, 'raised blind');
});

test('an album is one recording: energy by length, its loudest peak', () => {
  const album = albumLoudness([
    { r128: { i: -20, tp: -6 }, durationMs: 60_000 },
    { r128: { i: -8, tp: -0.5 }, durationMs: 240_000 },
    { durationMs: 100_000 },
  ]);
  assert(album, 'no album loudness');
  // 10·log10((1·10^−2 + 4·10^−0.8) / 5) ≈ −8.9
  assert(near(album!.i, 10 * Math.log10((10 ** -2 + 4 * 10 ** -0.8) / 5)), `album at ${album!.i}`);
  assert(album!.tp === -0.5, 'not its loudest peak');
  // The quiet intro keeps the album's level: no lift for it alone.
  assert(levellingGain(album) === 1, 'album raised past its peak');
  assert(albumLoudness([{ durationMs: 1 }]) === undefined, 'made up for an album without data');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
