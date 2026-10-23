// Offline unit tests for the equalizer's curve (src/player/eqCurve.ts): the same settings must do
// what they do in the official app (asked by the user: does Oni's equalizer sound like Yandex's?).
// The official app (app.asar 5.123): Web Audio, preamp gain, low shelf 60 Hz, peaking 170 Hz …
// 14 kHz with Q 1, high shelf 16 kHz; the user's curve there is read from its settings.
// Run: npm run test:eq
import { biquad, biquadDb, EQ_BANDS, EQ_PRESETS, eqResponse } from '../src/player/eqCurve.ts';

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

const YANDEX_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const yandexType = (i: number) => (i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking') as const;
/** The official app's curve, its own parameters. */
const yandex = (gains: number[], f: number) => YANDEX_BANDS.reduce((s, b, i) => s + biquadDb(biquad(yandexType(i), b, gains[i], 1), f), 0);
/** The user's curve in the official app (EqualizerConfig, 23.10.2026). */
const USER_YANDEX = [5.8, 4.8, 2, -1.9, -1.1, 1.3, 1.7, 5.4, 7.3, 7.1];

const freqs: number[] = [];
for (let f = 20; f <= 20000; f *= Math.pow(2, 1 / 24)) freqs.push(f);

function worst(a: (f: number) => number, b: (f: number) => number) {
  let max = 0;
  let at = 0;
  for (const f of freqs) {
    const d = Math.abs(a(f) - b(f));
    if (d > max) [max, at] = [d, f];
  }
  return { max, at: Math.round(at) };
}

await test('the bands are the official app\'s', () => {
  assert(EQ_BANDS.join() === YANDEX_BANDS.join(), `bands ${EQ_BANDS}`);
});

await test('the same settings give the official app\'s curve, every frequency', () => {
  for (const gains of [USER_YANDEX, EQ_PRESETS.rock, EQ_PRESETS.bass, [12, -12, 12, -12, 12, -12, 12, -12, 12, -12]]) {
    const w = worst((f) => eqResponse(gains, 0, f), (f) => yandex(gains, f));
    assert(w.max < 0.01, `${gains}: ${w.max.toFixed(2)} dB off at ${w.at} Hz`);
  }
});

await test('"Mine" is the user\'s curve from the official app, exactly', () => {
  assert(EQ_PRESETS.mine.join() === USER_YANDEX.join(), `mine ${EQ_PRESETS.mine}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
