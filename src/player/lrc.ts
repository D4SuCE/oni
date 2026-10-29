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

/** How long a letter is sung, at most and at least (s), and when the song does not say. */
const SLOWEST = 0.13;
const FASTEST = 0.05;
const SHORTEST = 0.6;
/** A line is done a little before the next one begins (a breath). */
const BREATH = 0.9;

const paces = new WeakMap<LrcLine[], number>();

/**
 * The song's own pace (s a letter), for lines with no word times. A line's time to the next one is
 * its singing and then a pause or a held note: filled over all of it, the words lagged behind the
 * voice (the user, 29.10.2026, Night Club's "The Creepshow": "Just fill us up with medication" sung
 * in about 3 s of its 5.5). The quicker quarter of the song's lines — those sung one right after
 * another — tells how fast it is sung; a little quicker than that, as early is less wrong than late.
 */
export function songPace(lines: LrcLine[]): number {
  let pace = paces.get(lines);
  if (pace === undefined) {
    const each = lines
      .map((l, i) => (l.text.length >= 8 && lines[i + 1] ? (lines[i + 1].t - l.t) / l.text.length : NaN))
      .filter((x) => Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b);
    const quick = each.length >= 4 ? each[Math.floor(each.length / 4)] * 0.8 : SLOWEST;
    pace = Math.min(SLOWEST, Math.max(FASTEST, quick));
    paces.set(lines, pace);
  }
  return pace;
}

/**
 * How many letters of the line at `i` are sung at `position` (a fraction, for a soft edge). By word
 * times when there are; otherwise evenly at the song's pace (songPace) — not over a pause, a held
 * note or a solo before the next line.
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
  const sung = Math.min(Math.max(0.1, (end - line.t) * BREATH), Math.max(SHORTEST, length * songPace(lines)));
  return Math.min(length, (length * (position - line.t)) / sung);
}
