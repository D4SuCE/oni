// The equalizer's bands and what they do to the sound, without any audio: shared by the player
// (eq.ts), its test (tests/eq.test.ts) and the iPhone's check of the system equalizer (ios-smoke.ts).
// The bands are the official app's: low shelf 60 Hz, peaking 170 Hz … 14 kHz at Q 1, high shelf
// 16 kHz (its app.asar, 5.123), so the same settings sound the same in both.

export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const EQ_RANGE = 12;
/** The peaking bands' Q, as in the official app (it was 1.1 here: up to 0.6 dB off near 9 kHz). */
export const EQ_Q = 1;

export type EqPreset = 'mine' | 'flat' | 'bass' | 'treble' | 'rock' | 'pop' | 'electronic' | 'hiphop' | 'vocal' | 'classical' | 'jazz';

export const EQ_PRESETS: Record<EqPreset, number[]> = {
  // the user's own curve in the official app, exactly (its settings, 23.10.2026): warm lows, a dip
  // around 600 Hz, bright highs
  mine: [5.8, 4.8, 2, -1.9, -1.1, 1.3, 1.7, 5.4, 7.3, 7.1],
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  rock: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5],
  pop: [-1, 1, 3, 4, 3, 1, -1, -1, -1, -1],
  electronic: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5],
  hiphop: [6, 5, 1, 2, -1, -1, 1, -1, 2, 3],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
};

export type BandType = 'lowshelf' | 'peaking' | 'highshelf';
export const bandType = (i: number): BandType => (i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking');

/** A band's biquad as the Web Audio spec computes it ([b0, b1, b2, a0, a1, a2]); the shelves have
 * no Q of their own there (slope 1). */
export function biquad(type: BandType, frequency: number, gain: number, q: number, rate = 44100): number[] {
  const A = Math.pow(10, gain / 40);
  const w = (2 * Math.PI * frequency) / rate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  if (type === 'peaking') {
    const alpha = sin / (2 * q);
    return [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  }
  const s = 2 * Math.sqrt(A) * (sin / 2) * Math.SQRT2;
  if (type === 'lowshelf') {
    return [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s), A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s];
  }
  return [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s), A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
}

/** How loud a biquad leaves `frequency`, in dB. */
export function biquadDb(c: number[], frequency: number, rate = 44100) {
  const w = (2 * Math.PI * frequency) / rate;
  const mag = (x0: number, x1: number, x2: number) => Math.hypot(x0 + x1 * Math.cos(w) + x2 * Math.cos(2 * w), x1 * Math.sin(w) + x2 * Math.sin(2 * w));
  return 20 * Math.log10(mag(c[0], c[1], c[2]) / mag(c[3], c[4], c[5]));
}

/** The whole equalizer at `frequency`, in dB: the preamp plus every band. */
export function eqResponse(gains: number[], preamp: number, frequency: number, q = EQ_Q) {
  return EQ_BANDS.reduce((sum, band, i) => sum + biquadDb(biquad(bandType(i), band, gains[i] ?? 0, q), frequency), preamp);
}
