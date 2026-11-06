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
// 3. To the words (its own setting, the user's choice after the first trial, 6.11.2026: "no difference
//    at all — as in the video, the music should skip to the words"): a long end with no singing is
//    left out (the crossing starts just after this track's last words) and a long start with no
//    singing too (the next one starts a couple of bars before its first words), the two voices a
//    breath apart — Apple's AutoMix cuts songs so. Not for an album played in order.
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
  /** To the words: this one stays at its own level this long (s, its last words), then fades out
   * (over the rest of `fade`); the next one comes in over `fadeIn` s (up to its first words). */
  hold?: number;
  fadeIn?: number;
  /** For the log and the tests. */
  why: string;
}

/** What the plan may do: lay the voices apart and the beats on each other (the DJ-like transition),
 * skip to the words (its own setting). */
export interface Allow {
  mix: boolean;
  jump: boolean;
}

/** To the words: a stretch with no singing longer than this is cut. */
const CUT = 8;
/** The next one's music before its first words (s), or as many of its beats (two bars). */
const LEAD_IN = 4;
const LEAD_BEATS = 8;
/** Between this one's last word and the next one's first (s). */
const WORD_GAP = 0.6;
/** This one fades out over this long after its last word, at least (s). */
const OUT_AFTER = 1.5;

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
export function plan(out: Outgoing, inc: Incoming, fade: number, allow: Allow = { mix: true, jump: false }): Plan {
  const end = Math.min(out.end, out.duration);
  const plain: Plan = { at: end - fade, fade, from: inc.lead, why: 'plain' };
  if (allow.jump) {
    const p = toWords(out, inc, fade, end, allow.mix);
    if (p) return p;
  }
  if (!allow.mix) return plain;
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

/**
 * Part 3, to the words: the next one's first words a breath after this one's last, with this one's
 * long wordless end and the next one's long wordless start left out. Null when neither is long (or
 * the singing is not known): the other parts plan it.
 */
function toWords(out: Outgoing, inc: Incoming, fade: number, end: number, mix: boolean): Plan | null {
  const vOut = out.voice;
  const vIn = inc.voice;
  if (!vOut || !vIn) return null;
  const cutEnd = end - vOut.last > CUT;
  // The next one's own steady grid (the DJ-like part on): its start on its beat, two bars before its words.
  const b = mix && steady(inc.grid) ? inc.grid : null;
  let from = inc.lead;
  if (vIn.first - inc.lead > CUT + LEAD_IN) {
    from = vIn.first - LEAD_IN;
    if (b) from = b.anchor + Math.round((vIn.first - LEAD_BEATS * b.period - b.anchor) / b.period) * b.period;
  }
  const skipStart = from > inc.lead;
  if (!cutEnd && !skipStart) return null;
  const rate = out.rate;
  // The next one's words come this long after it starts (this track's seconds).
  const before = (vIn.first - from) / rate;
  // When they come: a breath after this one's last word, and never over it.
  let words = vOut.last + WORD_GAP;
  // This one's end is kept (it sings near it): the crossing as late as the plain one, or later.
  if (!cutEnd) words = Math.max(words, end - fade + before);
  let at = words - before;
  // Beats laid on each other where both grids are steady and near in tempo (the next one at this one's tempo).
  let sync: Plan['sync'];
  const a = out.grid;
  const matched = mix && b && rate === 1 && steady(a) ? stretch(a, b) : null;
  if (matched !== null && a && b) {
    const k = Math.round((at - a.anchor) / a.period);
    const on = a.anchor + k * a.period;
    // The next one's start is on its beat (`from`): laid on this one's beat nearest the start.
    const startAt = on - SETTLE;
    if (startAt >= 0) {
      at = startAt;
      const lead = Math.max(0, from - SETTLE * matched);
      sync = { rate: matched, on, to: from, quiet: SETTLE };
      from = lead;
    }
  }
  const startHeard = at + (sync?.quiet ?? 0);
  // This one: at its own level to its last word (if it is still singing), then out shortly after the next one's words begin.
  const hold = Math.max(0, vOut.last - startHeard);
  const outEnd = Math.min(end, Math.max(vOut.last + OUT_AFTER, at + (sync?.quiet ?? 0) + (vIn.first - (sync ? sync.to : from)) / (sync?.rate ?? rate) + 1));
  const fadeLen = Math.max(MIN_FADE, outEnd - startHeard);
  const fadeIn = Math.max(0.5, Math.min(fadeLen, words - startHeard));
  if (at >= end - MIN_FADE) return null;
  return {
    at,
    fade: fadeLen,
    from,
    hold: Math.min(hold, fadeLen - 0.5),
    fadeIn,
    ...(sync && { sync }),
    why: `words: ${cutEnd ? `cut ${(end - vOut.last).toFixed(0)} s of its end` : 'its end kept'}, ${skipStart ? `from ${from.toFixed(1)} s` : 'from its start'}${sync ? `, beat ×${sync.rate.toFixed(3)}` : ''}`,
  };
}
