// The DJ-like transition (the user's wish, 6.11.2026, after Apple Music's AutoMix on iOS 27: "the
// words line up, no seam — as if it all were one track"). Two parts:
//
// 1. By the voice (both platforms): the next track comes in where this one's singing is over and
//    the next one's has not begun, so two voices never sing over each other. Where the singing is
//    comes from the synced lyrics (lrc.ts: a line is sung up to ~0.95 of the time to the next one).
// 2. By the beat (the desktop, where both grids are steady and the tempi within ±6%): the next track
//    plays at this one's tempo, its first beat on one of this one's, so the drums go on as one; after
//    the crossing it eases back to its own tempo. Tracks that differ more get part 1 alone — a tempo
//    pulled further sounds wrong (the user, rightly: "it will not be as smooth if the tracks differ").
//
// Pure: the plan from what is known of both tracks (tests/automix.test.ts).

import type { Grid } from './beatGrid.ts';
import { parseLrc, syllableWeights } from './lrc.ts';

/** Where the voice is in a track (s): its first line's start and its last line's end. Null: the
 * track has no words (an instrumental). */
export type Voice = { first: number; last: number } | null;

/** As lrc.ts's fill: a line is sung over 0.95 of the time to the next, no slower than 0.45 s a syllable. */
const SPAN = 0.95;
const SLOWEST = 0.45;

/** The voice's span from synced lyrics; undefined when the lyrics say nothing of it (none, or not synced). */
export function voiceOf(lyrics: { synced: boolean; text: string } | null | undefined, duration: number): Voice | undefined {
  if (!lyrics?.synced) return undefined;
  const lines = parseLrc(lyrics.text);
  const sung = lines.map((l, i) => ({ l, i, syl: syllableWeights(l.text).syllables })).filter((x) => x.syl > 0);
  if (!sung.length) return null;
  const first = sung[0].l.t;
  const last = sung[sung.length - 1];
  const next = lines[last.i + 1]?.t ?? duration;
  const end = last.l.end ?? last.l.words?.at(-1)?.t ?? last.l.t + Math.min(Math.max(0.6, (next - last.l.t) * SPAN), Math.max(0.6, last.syl * SLOWEST));
  return { first, last: Math.min(end, duration) };
}

/** A grid steady enough to lay another track's beats on (beatGrid.ts). */
export const steady = (g: Grid | null | undefined): g is Grid => Boolean(g && g.wobble <= 0.015 && g.onLine >= 0.75);

/** Tempo ratio within this of 1 (after halving or doubling): matched; further: by the voice only. */
const MAX_STRETCH = 0.06;
/** Between one voice's end and the next one's start (s). */
const GAP = 0.3;
/** The shortest crossing (s). */
const MIN_FADE = 1.5;
/** A matched crossing: at least this many of this track's beats, at most LONG of them (when this
 * one's end has no singing: an outro under the next one's intro, as a DJ does). */
const BEATS = 8;
const LONG = 16;
/** The beat on which the next one comes in is a bar's first, counted back from this one's last beat. */
const BAR = 4;
/** A matched crossing starts the next one this much before it is heard (silent): time to lay its
 * beat on this one's exactly (a start of an audio element is late by tens of ms, unknown before). */
export const SETTLE = 1;

export interface Outgoing {
  /** The track's length and where its music ends (s). */
  duration: number;
  end: number;
  voice?: Voice;
  /** Its beat grid, in the track's own time. */
  grid?: Grid | null;
  /** Its speed (a matched crossing only at 1). */
  rate: number;
}

export interface Incoming {
  /** Where it starts (past its silence at the start). */
  lead: number;
  voice?: Voice;
  grid?: Grid | null;
}

export interface Plan {
  /** This track's time at which the next one starts. */
  at: number;
  /** The crossing's length (s): this one fades out over it. */
  fade: number;
  /** Where the next one starts from (its time). */
  from: number;
  /** Matched: the next one's speed while crossing (this one's tempo), and the two beats laid on each
   * other — its `to` on this one's `on`; it is silent for `quiet` s (SETTLE), then the crossing (`fade`) begins. */
  sync?: { rate: number; on: number; to: number; quiet: number };
  /** For the log and the tests. */
  why: string;
}

/** The tempo ratio the next one needs to play at this one's (folded by octaves), or null when too far. */
export function stretch(out: Grid, inc: Grid): number | null {
  let r = inc.period / out.period;
  while (r > 1.5) r /= 2;
  while (r < 0.75) r *= 2;
  return Math.abs(r - 1) <= MAX_STRETCH ? r : null;
}

/**
 * The plan for the crossing from `out` into `inc`, with `fade` the crossfade asked for (s). The
 * plain crossfade (`end - fade`) is where it starts from; the voice moves it, the beat sets it.
 */
export function plan(out: Outgoing, inc: Incoming, fade: number): Plan {
  const end = Math.min(out.end, out.duration);
  const plain: Plan = { at: end - fade, fade, from: inc.lead, why: 'plain' };
  const matched = out.rate === 1 && steady(out.grid) && steady(inc.grid) ? stretch(out.grid, inc.grid) : null;
  if (matched !== null) {
    const p = beatPlan(out, inc, fade, end, matched);
    if (p) return p;
  }
  return byVoice(out, inc, end, plain);
}

/** Part 1: moved later (a shorter crossing) as far as this one's singing reaches into the next one's. */
function byVoice(out: Outgoing, inc: Incoming, end: number, plain: Plan): Plan {
  const vOut = out.voice;
  const vIn = inc.voice;
  // Not known on one side, or one side has no words: nothing to keep apart.
  if (!vOut || !vIn) return plain;
  // When the next one's voice comes (this track's time), started at `at`.
  const comes = (at: number) => at + (vIn.first - inc.lead) / out.rate;
  if (comes(plain.at) >= vOut.last + GAP) return { ...plain, why: 'voices apart already' };
  const at = Math.min(end - MIN_FADE, vOut.last + GAP - (vIn.first - inc.lead) / out.rate);
  if (at <= plain.at) return plain;
  return { at, fade: end - at, from: inc.lead, why: at === end - MIN_FADE ? 'voice: shortest crossing' : 'voice: later' };
}

/** Part 2: the next one's first steady beat on a bar of this one's, the crossing a whole number of beats. */
function beatPlan(out: Outgoing, inc: Incoming, fade: number, end: number, rate: number): Plan | null {
  const a = out.grid!;
  const b = inc.grid!;
  // The next one's first beat at or after where its sound starts; it starts SETTLE s earlier (silent).
  const k0 = Math.ceil((inc.lead - b.anchor) / b.period - 1e-6);
  const to = b.anchor + k0 * b.period;
  const from = Math.max(0, inc.lead - SETTLE * rate);
  // Its start to that beat, in this track's seconds (it plays at `rate`).
  const before = (to - from) / rate;
  // This one's last beat before its music ends: the bars count back from it.
  const lastK = Math.floor((end - a.anchor) / a.period);
  if (lastK < BEATS) return null;
  const beatAt = (k: number) => a.anchor + k * a.period;
  // The next one's voice in this track's time, laid on beat k: it comes `(vIn.first - to) / rate` after it.
  const vIn = inc.voice;
  const vOut = out.voice;
  const voiceOk = (k: number) => !vOut || !vIn || beatAt(k) + (vIn.first - to) / rate >= vOut.last + GAP;
  // This one's end with no singing in its last LONG beats: the long crossing; else BEATS (or the fade asked, if longer).
  const quietEnd = !vOut || vOut.last <= beatAt(lastK - LONG);
  const want = Math.ceil(Math.max(fade / a.period, quietEnd ? LONG : BEATS) / BAR) * BAR;
  for (let n = want; n >= BEATS; n -= BAR) {
    // The beat it comes in on: n beats (whole bars) before the last.
    const k = lastK - n;
    const on = beatAt(k);
    const at = on - before;
    if (at < 0 || !voiceOk(k)) continue;
    // Heard from SETTLE s after its start to this one's end (its sound before that, a first beat
    // too, is let go: given 0.3 s, it was 40 ms off when heard).
    const heard = at + SETTLE;
    return { at, fade: end - heard, from, sync: { rate, on, to, quiet: heard - at }, why: `beat: ${n} beats, ×${rate.toFixed(3)}${quietEnd ? ', outro' : ''}` };
  }
  return null;
}
