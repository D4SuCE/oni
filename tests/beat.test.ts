// Offline tests for the kick detector behind the beat pulse: synthetic rise streams, and a
// synthetic loud song heard the way the desktop (Chrome's analyser) and the iPhone (the native
// player's low-pass, PlayerPlugin.swift `listen`) hear it.
// Run: npm run test:beat
import { KickDetector, bassFlux, bassLoudness } from '../src/player/beat.ts';

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

/** Pulses for a stream of rises: `at(t)` gives the rise of the frame starting at t. */
function detect(seconds: number, at: (t: number) => number) {
  const kick = new KickDetector();
  const pulses: number[] = [];
  for (let t = 0; t < seconds * 1000; t += FRAME) if (kick.push(t, at(t))) pulses.push(t);
  return pulses;
}

/** Share of pulses that fell on a kick (just after it), and of kicks that got a pulse. */
function score(pulses: number[], kicks: number[], from = 0) {
  const on = (p: number, k: number) => p - k >= -FRAME && p - k <= 50;
  const ps = pulses.filter((p) => p >= from);
  const ks = kicks.filter((k) => k >= from);
  return {
    precision: ps.filter((p) => ks.some((k) => on(p, k))).length / Math.max(1, ps.length),
    recall: ks.filter((k) => ps.some((p) => on(p, k))).length / Math.max(1, ks.length),
  };
}
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

test('pulses on the kicks, not on the weaker bass bumps between them', () => {
  // a bump a third of the kick: on real songs a bass note rising nearly as much as the kick is
  // taken for one (beat.ts, NEAR_PEAK)
  const rand = rng(1);
  const kicks: number[] = [];
  const bumps: number[] = [];
  for (let t = 300; t < 15000; t += 500) {
    kicks.push(t + (rand() - 0.5) * 16);
    bumps.push(t + 250 + (rand() - 0.5) * 60);
  }
  const hit = (ts: number[], t: number) => ts.some((k) => k >= t && k < t + FRAME);
  const pulses = detect(15, (t) => rand() * 0.004 + (hit(kicks, t) ? 0.09 : 0) + (hit(bumps, t) ? 0.03 : 0));
  const { precision, recall } = score(pulses, kicks, 1000);
  assert(precision > 0.95 && recall > 0.9, `on kicks ${pct(precision)}, kicks caught ${pct(recall)}`);
});

test('a kick off the beat (syncopated) pulses too', () => {
  // a two-beat bar at 100 BPM: kicks on 1, the "and" of 2, and 2 of the next bar's half
  const kicks: number[] = [];
  for (let bar = 300; bar < 12000; bar += 1200) kicks.push(bar, bar + 450, bar + 750);
  const pulses = detect(12, (t) => (kicks.some((k) => k >= t && k < t + FRAME) ? 0.09 : 0.002));
  const { precision, recall } = score(pulses, kicks, 1000);
  assert(precision > 0.95 && recall > 0.95, `on kicks ${pct(precision)}, kicks caught ${pct(recall)}`);
});

test('quiet music and silence pulse nothing', () => {
  const rand = rng(11);
  const quiet = detect(10, () => rand() * 0.004 + (rand() < 0.04 ? rand() * 0.012 : 0));
  const silence = detect(5, () => 0);
  assert(quiet.length === 0 && silence.length === 0, `quiet ${quiet.length}, silence ${silence.length}`);
});

// ------------------------------------------------------------ a loud song, heard as the app hears it

const RATE = 48000;

/**
 * `seconds` of a song at `bpm`: a kick on every beat (a 120→50 Hz drop), a held bass line that
 * changes note on the off-beats, hi-hats, and a two-bar break (12–14 s) with no kick and a
 * near-silent bass; mastered loud by `drive` (soft clipping, as modern masters are).
 */
function song(bpm: number, seconds: number, drive: number) {
  const rand = rng(5);
  const len = Math.round(seconds * RATE);
  const x = new Float32Array(len);
  const p = 60 / bpm;
  const inBreak = (s: number) => s >= 12 && s < 14;
  const kicks: number[] = [];
  for (let b = 0.3; b < seconds; b += p) {
    if (!inBreak(b)) kicks.push(b * 1000);
    const s0 = Math.round(b * RATE);
    for (let i = 0; i < 0.3 * RATE && s0 + i < len; i++) {
      const t = i / RATE;
      if (!inBreak(b)) x[s0 + i] += 0.9 * Math.sin(2 * Math.PI * (50 * t + (70 / 30) * (1 - Math.exp(-t * 30)))) * Math.exp(-t * 9);
      if (i < 0.04 * RATE) x[s0 + i] += 0.12 * (rand() - 0.5) * Math.exp(-t * 80);
    }
  }
  const notes = [55, 55, 73.4, 65.4];
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / RATE;
    const k = Math.floor((t - 0.3 + p / 2) / (p / 2));
    phase += (2 * Math.PI * notes[((k % 4) + 4) % 4]) / RATE;
    x[i] = Math.tanh(drive * (x[i] + (inBreak(t) ? 0.02 : 0.35) * Math.sin(phase)));
  }
  return { x, kicks, breakAt: [12000, 14000] };
}

/** Chrome's AnalyserNode (fftSize 1024, smoothing 0.5, eq.ts `tapAnalyser`): a Blackman window,
 * |X| / N, smoothed, in dB — bins 0…5 only, 60 frames a second. */
function analyser(x: Float32Array) {
  const N = 1024;
  const w = Float32Array.from({ length: N }, (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N));
  const smooth = new Float32Array(6);
  const frames: { t: number; db: Float32Array }[] = [];
  for (let t = (N / RATE) * 1000; t < (x.length / RATE) * 1000; t += FRAME) {
    const end = Math.round((t / 1000) * RATE);
    const db = new Float32Array(6);
    for (let k = 0; k < 6; k++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < N; i++) {
        const v = x[end - N + i] * w[i];
        re += v * Math.cos((2 * Math.PI * k * i) / N);
        im -= v * Math.sin((2 * Math.PI * k * i) / N);
      }
      smooth[k] = 0.5 * smooth[k] + (0.5 * Math.hypot(re, im)) / N;
      db[k] = 20 * Math.log10(smooth[k]);
    }
    frames.push({ t, db });
  }
  return frames;
}

/** The desktop: the analyser's dB through `bassFlux`, or (`bytes`) as it was read before — the
 * analyser's byte scale, −100…−30 dB. */
function desktop(x: Float32Array, bytes = false) {
  const kick = new KickDetector();
  const pulses: number[] = [];
  let prev = new Float32Array(6).fill(-Infinity);
  for (const { t, db } of analyser(x)) {
    let flux: number;
    if (bytes) {
      const byte = (v: number) => Math.max(0, Math.min(255, Math.floor(((v + 100) * 255) / 70)));
      flux = 0;
      for (let i = 1; i <= 4; i++) flux += Math.max(0, byte(db[i]) - byte(prev[i]));
      flux /= 4 * 255;
    } else flux = bassFlux(db, prev);
    prev = db;
    if (kick.push(t, flux, bassLoudness(db))) pulses.push(t);
  }
  return pulses;
}

/** The iPhone, as PlayerPlugin.swift `listen` does it: band-pass filters (Q 3) at the analyser's
 * bins 1–4, their RMS over the last 1024 samples 60 times a second, smoothed by half, in the
 * analyser's dB (× 0.297) — then `bassFlux`, as pulse.ts does with what it sends. */
function iphone(x: Float32Array) {
  const bands = [1, 2, 3, 4].map((k) => {
    const w = (2 * Math.PI * 46.875 * k) / RATE;
    const alpha = Math.sin(w) / 6;
    const a0 = 1 + alpha;
    const [b0, a1, a2] = [alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
    const y = new Float32Array(x.length);
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    for (let i = 0; i < x.length; i++) {
      y[i] = b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2;
      [x2, x1, y2, y1] = [x1, x[i], y1, y[i]];
    }
    return y;
  });
  const hop = RATE / 60;
  const kick = new KickDetector();
  const pulses: number[] = [];
  const level = [0, 0, 0, 0];
  let prev = new Float32Array(5).fill(-Infinity);
  for (let i = hop; i <= x.length; i += hop) {
    const db = new Float32Array(5).fill(-Infinity);
    bands.forEach((y, k) => {
      let e = 0;
      for (let j = Math.max(0, i - 1024); j < i; j++) e += y[j] * y[j];
      level[k] = 0.5 * level[k] + 0.5 * Math.sqrt(e / 1024);
      db[k + 1] = 20 * Math.log10(Math.max(level[k] * 0.297, 1e-10));
    });
    const t = (i / RATE) * 1000;
    if (kick.push(t, bassFlux(db, prev), bassLoudness(db))) pulses.push(t);
    prev = db;
  }
  return pulses;
}

// What to expect, from the real songs checked against their drums split out by Demucs (beat.ts):
// a clean loud master is caught almost whole; an overdriven one (a wall of clipped bass, hard trap)
// loses many kicks, but what throbs is still mostly a kick, and a break throbs not at all.
for (const [bpm, drive, want] of [[120, 1.3, 0.85], [120, 4, 0.5], [95, 4, 0.5]] as const) {
  const { x, kicks, breakAt } = song(bpm, 20, drive);
  const inBreak = (ps: number[]) => ps.filter((p) => p > breakAt[0] + 100 && p < breakAt[1]).length;
  for (const [where, hear] of [['desktop', desktop], ['iPhone', iphone]] as const) {
    test(`a loud master (${bpm} BPM, drive ${drive}), ${where}: pulses on the kicks, none in the break`, () => {
      const pulses = hear(x);
      const { precision, recall } = score(pulses, kicks, 2000);
      assert(precision > Math.max(want, 0.6) && recall > want && !inBreak(pulses), `on kicks ${pct(precision)}, kicks caught ${pct(recall)}, in the break ${inBreak(pulses)}`);
    });
  }
}

test("the analyser's byte scale loses a loud master's kicks (why bassFlux reads dB)", () => {
  const { x, kicks } = song(120, 20, 4);
  const { recall } = score(desktop(x, true), kicks, 2000);
  assert(recall < 0.6, `the byte scale caught ${pct(recall)} of the kicks`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
