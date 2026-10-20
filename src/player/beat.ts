// Beat tracker: turns a stream of low-band onset strength ("flux", one value per frame)
// into beats that sit on the song's pulse instead of on every bump in the bass.
//
// 1. Tempo: the onset envelope of the last six seconds, binned to 10 ms, is
//    autocorrelated over the lags of 70–180 BPM (gently preferring ~120). The strongest
//    lag is the beat period, once two estimates in a row agree.
// 2. Phase: for that period, the offset where the envelope is strongest every period
//    (a comb over the history) — the kick, which repeats, beats hi-hats and bass bumps,
//    which wander. That gives a grid of expected beats.
// 3. On the grid, an onset within ±15% of an expected beat fires it and pulls the grid a
//    little towards itself (a soft phase lock); bumps elsewhere are ignored. A beat that passes with no onset gets a soft pulse — but only while the grid
//    is confirmed by most beats; if hardly any beat lands, the lock is dropped.
// 4. Before there is a tempo, only clearly strong onsets count.
//
// Pure and clock-agnostic (times are passed in), so it is tested offline.

const SLOT_MS = 10;
const HISTORY_MS = 6000;
const SLOTS = HISTORY_MS / SLOT_MS;
const MIN_BPM = 70;
const MAX_BPM = 180;
const WINDOW = 0.15; // of a period, each side of an expected beat
/** How much of a hit's offset from the grid pulls the grid along (a soft phase lock). */
const PULL = 0.4;

export interface Beat {
  /** 0…1: how hard to pulse. */
  strength: number;
  /** On the tempo grid (true) or just a strong onset before the tempo is known. */
  locked: boolean;
}

export class BeatTracker {
  private env = new Float32Array(SLOTS);
  private head = -1;
  private recent: number[] = [];
  private periodMs: number | null = null;
  private candidate: number | null = null;
  /** The next expected beat on the grid (ms), and whether it already fired. */
  private next: number | null = null;
  private fired = false;
  /** Share of recent grid beats that had a real onset (moving average). */
  private hitRate = 0.5;
  private lastFree = -Infinity;
  private lastEstimate = -Infinity;
  private started = Infinity;
  private peak = 0;
  confidence = 0;

  get bpm() {
    return this.periodMs ? 60000 / this.periodMs : null;
  }

  /** Feed one frame's onset strength at time `t` (ms). Returns a beat if one falls here. */
  push(t: number, flux: number): Beat | null {
    if (this.started === Infinity) this.started = t;
    this.store(t, flux);
    if (t - this.lastEstimate > 1000) {
      this.estimate(t);
      this.lastEstimate = t;
    }

    // local adaptive threshold over the last ~0.7 s of frames
    this.recent.push(flux);
    if (this.recent.length > 42) this.recent.shift();
    const mean = this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    const sd = Math.sqrt(this.recent.reduce((a, b) => a + (b - mean) ** 2, 0) / this.recent.length);
    const onset = flux > 0.01 && flux > mean + 1.5 * sd;
    const strength = Math.min(1, 0.45 + (flux - mean) / (4 * sd + 0.01));
    // the strongest onset of the last ~2 s, slowly forgotten
    this.peak = Math.max(flux, this.peak * 0.997);

    const p = this.periodMs;
    if (!p || this.next === null) {
      // no tempo yet: only the hardest hits (near the recent peak — usually the kick), spaced out
      if (onset && flux > 0.02 && flux >= 0.8 * this.peak && t - this.lastFree > 300) {
        this.lastFree = t;
        return { strength, locked: false };
      }
      return null;
    }

    if (t > this.next + WINDOW * p) {
      // the window of the expected beat has passed: book it and move on
      const hit = this.fired;
      this.hitRate = this.hitRate * 0.9 + (hit ? 0.1 : 0);
      do this.next += p;
      while (t > this.next + WINDOW * p);
      this.fired = false;
      if (this.hitRate < 0.3) {
        this.drop();
        return null;
      }
      // a quiet beat on a confirmed grid: a soft pulse keeps the groove
      if (!hit && this.hitRate > 0.6) return { strength: 0.3, locked: true };
    }
    if (!this.fired && onset && Math.abs(t - this.next) <= WINDOW * p) {
      this.fired = true;
      this.next += PULL * (t - this.next);
      return { strength, locked: true };
    }
    return null;
  }

  private drop() {
    this.periodMs = null;
    this.next = null;
    this.candidate = null;
    this.hitRate = 0.5;
  }

  private store(t: number, flux: number) {
    const slot = Math.floor(t / SLOT_MS);
    if (this.head < 0) this.head = slot;
    if (slot - this.head > SLOTS) this.env.fill(0);
    while (this.head < slot) {
      this.head++;
      this.env[this.head % SLOTS] = 0;
    }
    const i = slot % SLOTS;
    this.env[i] = Math.max(this.env[i], flux);
  }

  /** The envelope oldest-first, mean-removed. */
  private history() {
    const x = new Float32Array(SLOTS);
    for (let k = 0; k < SLOTS; k++) x[k] = this.env[(((this.head - SLOTS + 1 + k) % SLOTS) + SLOTS) % SLOTS];
    return x;
  }

  /** Tempo by autocorrelation, then the phase of the grid by a comb over the history. */
  private estimate(now: number) {
    // a tempo from less than four seconds of music is mostly guesswork
    if (now - this.started < 4000) return;
    const raw = this.history();
    const x = Float32Array.from(raw);
    const mean = x.reduce((a, b) => a + b, 0) / SLOTS;
    for (let k = 0; k < SLOTS; k++) x[k] -= mean;
    let r0 = 0;
    for (let k = 0; k < SLOTS; k++) r0 += x[k] * x[k];
    if (r0 <= 1e-9) return;

    const minLag = Math.round(60000 / MAX_BPM / SLOT_MS);
    const maxLag = Math.round(60000 / MIN_BPM / SLOT_MS);
    const r = new Float32Array(maxLag + 2);
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let k = lag; k < SLOTS; k++) s += x[k] * x[k - lag];
      r[lag] = s / r0;
    }
    let best = 0;
    let bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (r[lag] < r[lag - 1] || r[lag] < r[lag + 1]) continue; // local peaks only
      const bpm = 60000 / (lag * SLOT_MS);
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.5) ** 2); // a slight pull towards ~120
      const score = r[lag] * (0.85 + 0.15 * prior);
      if (score > bestScore) {
        bestScore = score;
        best = lag;
      }
    }
    if (!best) return;
    const a = r[best - 1];
    const b = r[best];
    const c = r[best + 1];
    const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
    const period = (best + shift) * SLOT_MS;
    this.confidence = b;
    if (b < 0.2) return; // nothing periodic enough: keep what we had

    // switch tempo only after two estimates agree, so one odd bar doesn't throw it off
    const close = (u: number, v: number) => Math.abs(u - v) / v < 0.08;
    if (this.periodMs && close(period, this.periodMs)) this.periodMs = this.periodMs * 0.7 + period * 0.3;
    else if (this.candidate && close(period, this.candidate)) {
      this.periodMs = period;
      this.hitRate = 0.5;
    } else {
      this.candidate = period;
      return;
    }
    this.candidate = null;

    // phase: the offset (back from now) where the envelope peaks every period
    const p = this.periodMs!;
    const pSlots = p / SLOT_MS;
    let bestPhase = 0;
    let bestSum = -Infinity;
    for (let phase = 0; phase < pSlots; phase++) {
      let sum = 0;
      for (let k = SLOTS - 1 - phase; k >= 0; k -= pSlots) {
        const i = Math.round(k);
        sum += Math.max(raw[i] ?? 0, raw[i - 1] ?? 0, raw[i + 1] ?? 0);
      }
      if (sum > bestSum) {
        bestSum = sum;
        bestPhase = phase;
      }
    }
    const lastGridBeat = (this.head - bestPhase) * SLOT_MS;
    let next = lastGridBeat + p;
    while (next < now - WINDOW * p) next += p;
    // re-align only when the grid drifted noticeably, so a beat isn't fired twice
    if (this.next === null || Math.abs(((((next - this.next + p / 2) % p) + p) % p) - p / 2) > 0.1 * p) {
      this.next = next;
      this.fired = false;
    }
  }

  reset() {
    this.env.fill(0);
    this.head = -1;
    this.recent = [];
    this.drop();
    this.lastFree = this.lastEstimate = -Infinity;
    this.started = Infinity;
    this.confidence = 0;
  }
}
