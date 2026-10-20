// Offline tests for the beat tracker behind the beat pulse (synthetic onset streams).
// Run: npm run test:beat
import { BeatTracker } from '../src/player/beat.ts';

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

/** Deterministic noise. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

const FRAME = 1000 / 60;

/**
 * A song at `bpm`: a kick on every beat (with ±8 ms timing slop), bass/hi-hat bumps between
 * the beats almost as strong, and background noise. Returns the kick times and the beats fired.
 */
function run(bpm: number, seconds: number, opts: { offbeats?: number; kick?: number } = {}) {
  const { offbeats = 2, kick = 0.09 } = opts;
  const rand = rng(bpm * 7 + 1);
  const period = 60000 / bpm;
  const kicks: number[] = [];
  const bumps: number[] = [];
  for (let t = 300; t < seconds * 1000; t += period) {
    kicks.push(t + (rand() - 0.5) * 16);
    for (let k = 0; k < offbeats; k++) bumps.push(t + period * (0.25 + rand() * 0.5));
  }
  const tracker = new BeatTracker();
  const beats: { t: number; locked: boolean; strength: number }[] = [];
  for (let t = 0; t < seconds * 1000; t += FRAME) {
    let flux = rand() * 0.004;
    if (kicks.some((k) => k >= t && k < t + FRAME)) flux += kick;
    if (bumps.some((b) => b >= t && b < t + FRAME)) flux += kick * 0.7;
    const b = tracker.push(t, flux);
    if (b) beats.push({ t, ...b });
  }
  return { kicks, beats, tracker };
}

const near = (t: number, ts: number[], within: number) => ts.some((k) => Math.abs(k - t) <= within);

test('before the tempo is known, only the hardest hits pulse', () => {
  const { kicks, beats } = run(120, 5);
  const early = beats.filter((b) => !b.locked);
  assert(early.length > 0, 'some early pulses');
  const onKick = early.filter((b) => near(b.t, kicks, 35)).length / early.length;
  assert(onKick > 0.85, `early pulses should be kicks, ${(onKick * 100).toFixed(0)}% were`);
});

test('locks onto 120 BPM and pulses on the kicks, not on the bumps between them', () => {
  const { kicks, beats, tracker } = run(120, 18);
  const bpm = tracker.bpm!;
  assert(bpm && Math.abs(bpm - 120) < 3, `tempo ${bpm}`);
  // the tempo locks within the first ~6 s; judge the beats after that
  const after = beats.filter((b) => b.t > 8000);
  const perSecond = after.length / 10;
  assert(perSecond > 1.8 && perSecond < 2.2, `~2 beats a second expected, got ${perSecond.toFixed(2)}`);
  const onKick = after.filter((b) => near(b.t, kicks, 35)).length / after.length;
  assert(onKick > 0.9, `beats should sit on kicks, ${(onKick * 100).toFixed(0)}% did`);
});

test('works at other tempos (90 and 150 BPM)', () => {
  for (const bpm of [90, 150]) {
    const { beats, tracker } = run(bpm, 18);
    assert(tracker.bpm && Math.abs(tracker.bpm - bpm) / bpm < 0.04, `${bpm}: tempo ${tracker.bpm}`);
    const rate = beats.filter((b) => b.t > 8000).length / 10;
    assert(Math.abs(rate - bpm / 60) < 0.25, `${bpm}: ${rate.toFixed(2)} beats/s`);
  }
});

test('keeps the groove through a bar without kicks with soft beats', () => {
  const rand = rng(3);
  const tracker = new BeatTracker();
  const soft: number[] = [];
  for (let t = 0; t < 14000; t += FRAME) {
    const inBreak = t > 10000 && t < 12000;
    const kick = !inBreak && Math.abs(((t - 300) % 500) - 0) < FRAME;
    const b = tracker.push(t, rand() * 0.004 + (kick ? 0.09 : 0));
    if (b && inBreak) soft.push(b.strength);
  }
  assert(soft.length >= 3 && soft.every((s) => s <= 0.3), `soft beats in the break: ${soft}`);
});

test('random bumps with no steady beat give few pulses', () => {
  const rand = rng(11);
  const tracker = new BeatTracker();
  let n = 0;
  for (let t = 0; t < 10000; t += FRAME) {
    const flux = rand() * 0.004 + (rand() < 0.04 ? rand() * 0.05 : 0);
    if (tracker.push(t, flux)) n++;
  }
  assert(n / 10 < 1.6, `at most a moderate rate without a beat, got ${(n / 10).toFixed(2)}/s`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
