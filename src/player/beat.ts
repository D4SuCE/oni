// Kick detector: turns a stream of the bass's rise ("flux", one value per frame) into the
// moments the kick drum hits — the cover throbs on the kick itself, nothing else.
//
// It used to track the beat (a tempo grid with soft pulses on beats with no kick): on real
// songs the grid often sat off the music, throbbed into near-silence or skipped kicks off the
// grid; the user asked for the kick alone (26.10.2026).
//
// A kick is a rise that stands out of the last ~0.7 s (mean + 1.5 sd) and comes near the
// strongest of the last few seconds (a bass note's change rises less), at least 150 ms after
// the previous one. Quiet music and silence pulse nothing. A weak rise throbs faintly: against
// drums split out of nine real songs (Demucs), rises under 0.06 were a kick about a third of the
// time, strong ones about two thirds. A wall of overdriven bass (hard trap) hardly rises at all,
// so it throbs little — rather that than throbbing at random.
//
// Pure and clock-agnostic (times are passed in), so it is tested offline.

/**
 * The bass's rise for one frame (0…1) from the analyser's low bins in dB (1–4: ~47–190 Hz at
 * 48 kHz / 1024, the kick and the bass), each mapped over BASS_DB below. The analyser's byte
 * scale (−100…−30 dB) pinned a loud master's bass at the top: a kick over a held bass line rose
 * by nothing and the pulse fell after the quiet bits instead (the user: it often hits
 * near-silence or misses; tests/beat.test.ts, "a loud master").
 */
export function bassFlux(db: ArrayLike<number>, prev: ArrayLike<number>) {
  let flux = 0;
  for (let i = 1; i <= 4; i++) flux += Math.max(0, bassLevel(db[i]) - bassLevel(prev[i]));
  return flux / 4;
}

/** How loud the bass is (0…1, the mean of the low bins' levels): `KickDetector.push`'s `level`. */
export function bassLoudness(db: ArrayLike<number>) {
  let sum = 0;
  for (let i = 1; i <= 4; i++) sum += bassLevel(db[i]);
  return sum / 4;
}

/** −80…−10 dB to 0…1: the low bins of a full-scale sine sit at about −13 dB. */
const BASS_DB = { floor: -80, range: 70 };
const bassLevel = (db: number) => Math.min(1, Math.max(0, (db - BASS_DB.floor) / BASS_DB.range));

/** Frames of the local threshold (~0.7 s at 60 a second). */
const RECENT = 42;
/** A kick rises at least this share of the recent strongest rise (0.4 caught the most kicks for
 * the fewest misses on the real songs; 0.55 lost kicks, lower took the bass). */
const NEAR_PEAK = 0.4;
/** Below this rise nothing pulses (quiet music, a fade, silence); FULL and over throbs fully. */
const FLOOR = 0.02;
const FULL = 0.12;
const GAP_MS = 150;
/** A rise while the bass is this far (0…1 of 70 dB, ~21 dB) under its loudest of the last few
 * seconds is a hi-hat or a breath in a break, not a kick. */
const BELOW_LOUDEST = 0.3;

export interface Beat {
  /** 0…1: how hard to pulse. */
  strength: number;
}

export class KickDetector {
  private recent: number[] = [];
  private peak = 0;
  private loudest = 0;
  private last = -Infinity;

  /** Feed one frame's bass rise at time `t` (ms), with how loud the bass is (`bassLoudness`).
   * Returns a beat if a kick hits here. */
  push(t: number, flux: number, level = 1): Beat | null {
    this.recent.push(flux);
    if (this.recent.length > RECENT) this.recent.shift();
    const mean = this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    const sd = Math.sqrt(this.recent.reduce((a, b) => a + (b - mean) ** 2, 0) / this.recent.length);
    // the strongest rise of the last few seconds, slowly forgotten
    this.peak = Math.max(flux, this.peak * 0.995);
    this.loudest = Math.max(level, this.loudest - 0.0005);
    if (level < this.loudest - BELOW_LOUDEST) return null;
    if (flux < FLOOR || flux <= mean + 1.5 * sd || flux < NEAR_PEAK * this.peak || t - this.last < GAP_MS) return null;
    this.last = t;
    return { strength: Math.min(1, 0.3 + (0.7 * (flux - FLOOR)) / (FULL - FLOOR)) };
  }

  reset() {
    this.recent = [];
    this.peak = this.loudest = 0;
    this.last = -Infinity;
  }
}
