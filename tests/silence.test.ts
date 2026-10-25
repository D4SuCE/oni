// Offline tests for the smart crossfade's ears (src/player/silence.ts): where the music starts and
// ends in samples, when the start's silence is worth skipping, and hearing a track's end as it plays.
// Run: npm run test:silence
import { firstAudible, lastAudible, leadFrom, QuietTail } from '../src/player/silence.ts';

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

const RATE = 1000;
/** `silence` s of near silence (-60 dB hiss), `sound` s of a tone, `after` s of silence again. */
function track(silence: number, sound: number, after: number) {
  const n = Math.round((silence + sound + after) * RATE);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    c[i] = t >= silence && t < silence + sound ? 0.5 * Math.sin(i) : 0.001 * Math.sin(i * 7);
  }
  return c;
}

test('the first and the last sound, the hiss under -50 dB left out', () => {
  const c = track(1.2, 3, 4);
  assert(Math.abs(firstAudible([c], RATE) - 1.2) < 0.01, `first ${firstAudible([c], RATE)}`);
  assert(Math.abs(lastAudible([c], RATE) - 4.2) < 0.01, `last ${lastAudible([c], RATE)}`);
});

test('a sound in either channel counts', () => {
  const silent = new Float32Array(3000);
  const right = track(0.5, 1, 1.5);
  assert(Math.abs(firstAudible([silent, right], RATE) - 0.5) < 0.01, 'the right channel not heard');
});

test('the start is skipped only when its silence is long enough, and not too long to look at', () => {
  assert(leadFrom([track(0.1, 2, 0)], RATE) === 0, 'a breath skipped');
  assert(Math.abs(leadFrom([track(1.5, 2, 0)], RATE) - 1.5) < 0.01, 'a gap kept');
  assert(leadFrom([track(9, 1, 0)], RATE) === 0, 'nine seconds skipped (looked at 8 at most)');
});

test("a track's end is heard after a second and a half of quiet, for the volume it plays at", () => {
  const ear = new QuietTail(1.5);
  assert(!ear.feed(100, 0.2, 1), 'loud taken for quiet');
  assert(!ear.feed(100.5, 0.001, 1), 'over at once');
  assert(!ear.feed(101.5, 0.001, 1), 'over after a second');
  assert(ear.feed(102.1, 0.001, 1), 'not over after 1.6 s of quiet');
  // A rest in the music: quiet, then sound again, starts over.
  ear.reset();
  ear.feed(10, 0.001, 1);
  ear.feed(11, 0.3, 1);
  assert(!ear.feed(12, 0.001, 1), 'a rest taken for the end');
  // Played at a tenth of the volume: what is quiet is judged for that volume.
  assert(!new QuietTail(0).feed(0, 0.02, 0.1), 'quiet music at a low volume taken for silence');
  assert(!new QuietTail(0).feed(0, 0, 0.01), 'heard with the volume at nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
