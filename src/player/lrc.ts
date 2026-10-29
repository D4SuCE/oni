// Synced lyrics (LRC) for the lyrics tab: lines with their times and, the line sung now, how much
// of it is sung (it fills word by word, as Aria does — docs/other-clients.md). Word times come from
// "enhanced" LRC (<mm:ss.xx> before a word), rare; without them the line fills letter by letter
// over the time it is likely sung.

export interface LrcWord {
  t: number;
  text: string;
}

export interface LrcLine {
  t: number;
  text: string;
  /** Enhanced LRC: each word's start (the words' texts make up `text`). */
  words?: LrcWord[];
  /** Enhanced LRC: when the last word ends (a stamp with no word after it). */
  end?: number;
}

const STAMP = /\[(\d+):(\d+(?:[.:]\d+)?)\]/g;
const WORD = /<(\d+):(\d+(?:[.:]\d+)?)>/g;

const seconds = (m: string, s: string) => Number(m) * 60 + Number(s.replace(':', '.'));

/** Lines by time. A line may carry several times (a chorus written once); [ar:…] and the like are skipped. */
export function parseLrc(text: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const times: number[] = [];
    let rest = line;
    STAMP.lastIndex = 0;
    for (let m = STAMP.exec(line); m && m.index === line.length - rest.length; m = STAMP.exec(line)) {
      times.push(seconds(m[1], m[2]));
      rest = line.slice(STAMP.lastIndex);
    }
    if (!times.length) continue;
    const sung = wordsOf(rest);
    const words = sung?.words;
    const plain = words ? words.map((w) => w.text).join('').trim() : rest.trim();
    for (const t of times) lines.push({ t, text: plain, ...(words && { words }), ...(sung?.end !== undefined && { end: sung.end }) });
  }
  return lines.sort((a, b) => a.t - b.t);
}

/** Enhanced LRC's words: "<00:12.10>Hello <00:12.60>world<00:13.20>"; null when the line has no word times. */
function wordsOf(rest: string): { words: LrcWord[]; end?: number } | null {
  const stamps = [...rest.matchAll(WORD)];
  if (!stamps.length) return null;
  const words: LrcWord[] = [];
  let end: number | undefined;
  stamps.forEach((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < stamps.length ? stamps[i + 1].index! : rest.length;
    const text = rest.slice(from, to);
    // The first word keeps no leading space; a stamp with nothing after it says when the last word ends.
    if (text.trim()) words.push({ t: seconds(m[1], m[2]), text: words.length ? text : text.trimStart() });
    else if (i === stamps.length - 1) end = seconds(m[1], m[2]);
  });
  return words.length ? { words, end } : null;
}

/** A line lights up this much before its time (s), for the eye to be there when the voice is. */
export const LEAD = 0.3;

/** The line lit at `position`: the last one begun, LEAD early. */
export const activeLine = (lines: LrcLine[], position: number) => lines.findLastIndex((l) => l.t <= position + LEAD);

/**
 * How many letters of the line lit (activeLine) show as sung at `position`: on the same clock, LEAD
 * early — on the plain one the line was given up 0.3 s before its fill ended, and the last words of a
 * quick line never lit (the user, 29.10.2026: "the endings of the last words are eaten").
 */
export const litLetters = (lines: LrcLine[], i: number, position: number, duration = Infinity) => sungLetters(lines, i, position + LEAD, duration + LEAD);

/*
 * How a line with no word times is sung, measured (29.10.2026) on the voice alone (Demucs) in six
 * songs, 330 lines — Rap God, Night Club's "The Creepshow", Kerli, Skid Row, Beck, Yung Lean: a line
 * is sung nearly up to the next one (its last syllable at ~0.8 of the time to it, the voice gone at
 * ~0.94), and Rap God's voice comes in 0.26 s before the line's time. Filled over 0.95 of that time
 * (LEAD early), no slower than 0.45 s a syllable (after a line, a solo), the fill is 0.16–0.35 s off
 * the voice, neither early nor late on the whole. Filled over all of the time, it lagged 0.3–0.7 s
 * (2.3.0, the user: "the song goes faster than the words"); at a guessed quick pace it ran 0.4–1.2 s
 * ahead (2.3.2, the user: "it rushes").
 */
const SPAN = 0.95;
const SLOWEST = 0.45;
const SHORTEST = 0.6;

const VOWEL = /[aeiouyаеёиоуыэюяàáâãäåæèéêëìíîïòóôõöøùúûüýÿœ]/i;
const LETTER = /[\p{L}\p{N}]/u;

/**
 * Each letter's share of the line's singing: a syllable each (a vowel group with the consonants up to
 * the next one), spread over its letters; spaces and signs none, nor words in brackets (a second voice,
 * "(six minutes, Slim Shady)": it is not what the line's own voice spends its time on).
 */
export function syllableWeights(text: string): { weights: number[]; syllables: number } {
  const weights: number[] = Array.from({ length: text.length }, () => 0);
  const all: number[][] = [];
  let syllable: number[] = [];
  let depth = 0;
  let vowelSeen = false;
  let lastVowel = false;
  const endWord = () => {
    if (syllable.length) all.push(syllable);
    syllable = [];
    vowelSeen = lastVowel = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    if (depth > 0) {
      if (c === ')' || c === ']') depth--;
      endWord();
      continue;
    }
    // "I'm", "don't": one word.
    if (c === "'" || c === '’') continue;
    if (!LETTER.test(c)) {
      endWord();
      continue;
    }
    const vowel = VOWEL.test(c);
    if (vowel && !lastVowel && vowelSeen) {
      all.push(syllable);
      syllable = [];
    }
    syllable.push(i);
    vowelSeen ||= vowel;
    lastVowel = vowel;
  }
  endWord();
  for (const s of all) for (const i of s) weights[i] = 1 / s.length;
  return { weights, syllables: all.length };
}

const shapes = new WeakMap<LrcLine, { weights: number[]; syllables: number }>();
const shapeOf = (l: LrcLine) => {
  let shape = shapes.get(l);
  if (!shape) shapes.set(l, (shape = syllableWeights(l.text)));
  return shape;
};

/** The letter reached when `share` (0–1) of the syllables is sung: a fraction inside it. */
function letterAt(weights: number[], total: number, share: number): number {
  const target = share * total;
  let done = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (w > 0 && done + w >= target) return i + (target - done) / w;
    done += w;
  }
  return weights.length;
}

/**
 * How many letters of the line at `i` are sung at `position` (a fraction, for a soft edge). By word
 * times when there are; otherwise syllable by syllable over nearly all the time to the next line (as
 * measured, see SPAN), not slower than SLOWEST — not crawling through a solo.
 */
export function sungLetters(lines: LrcLine[], i: number, position: number, duration = Infinity): number {
  const line = lines[i];
  const length = line.text.length;
  if (!length || position <= line.t) return 0;
  const end = Math.min(lines[i + 1]?.t ?? duration, duration);
  if (line.words) {
    let done = 0;
    for (let w = 0; w < line.words.length; w++) {
      const word = line.words[w];
      const from = done;
      done += word.text.length;
      if (position < word.t) return from;
      const wordEnd = Math.min(line.words[w + 1]?.t ?? line.end ?? end, end);
      if (position < wordEnd) return from + (word.text.length * (position - word.t)) / Math.max(0.05, wordEnd - word.t);
    }
    return length;
  }
  const { weights, syllables } = shapeOf(line);
  if (!syllables) return length;
  const sung = Math.min(Math.max(0.1, (end - line.t) * SPAN), Math.max(SHORTEST, syllables * SLOWEST));
  const share = (position - line.t) / sung;
  return share >= 1 ? length : letterAt(weights, syllables, share);
}
