// Offline tests for picking LRCLIB's lyrics (src/player/lrclib.ts): the song of the track's length,
// synced first; covers, live takes and instrumentals left out.
// Run: npm run test:lyrics
import { pickLrclib } from '../src/player/lrclib.ts';
import { activeLine, LEAD, litLetters, parseLrc, sungLetters, syllableWeights, type LrcLine } from '../src/player/lrc.ts';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** A made-up song: at each time a line of so many syllables ("la la …"). */
const song = (at: [number, number][]): LrcLine[] => parseLrc(at.map(([t, n]) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]${Array(n).fill('la').join(' ')}`).join('\n'));

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.message || e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const synced = '[00:12.00] Du\n[00:14.50] Du hast';

test('the one of the same length, synced before plain', () => {
  const got = pickLrclib(
    [
      { duration: 233, plainLyrics: 'Du\nDu hast' },
      { duration: 235, syncedLyrics: synced, plainLyrics: 'Du\nDu hast' },
    ],
    234,
  );
  assert(got?.synced && got.text === synced && got.source === 'lrclib', JSON.stringify(got));
});

test('a live take or a remix of another length is not the track', () => {
  assert(pickLrclib([{ duration: 290, syncedLyrics: synced }], 234) === null, 'a longer take taken');
});

test('plain lyrics when there are no synced ones; instrumentals and empty ones left out', () => {
  const got = pickLrclib(
    [
      { duration: 234, instrumental: true, syncedLyrics: '' },
      { duration: 234, plainLyrics: '   ' },
      { duration: 233, plainLyrics: 'Words' },
    ],
    234,
  );
  assert(got && !got.synced && got.text === 'Words', JSON.stringify(got));
  assert(pickLrclib([{ duration: 234, instrumental: true }], 234) === null, 'an instrumental has lyrics');
});

test('nothing found is none', () => {
  assert(pickLrclib([], 200) === null, 'something from nothing');
});

test('LRC: lines by time, a chorus written once with two times, tags skipped', () => {
  const lines = parseLrc('[ar:Rammstein]\n[00:12.00] Du\n[00:20.00][01:10.50]Du hast mich\n[00:14.50] Du hast\n\n[00:30.00]');
  assert(lines.map((l) => `${l.t}:${l.text}`).join('|') === '12:Du|14.5:Du hast|20:Du hast mich|30:|70.5:Du hast mich', JSON.stringify(lines));
});

test('a line is lit whole by the moment the next one takes over (the user: the last words of a line were eaten)', () => {
  // Times of Eminem's "Rap God" (its quick part) and about its lines' syllables, the words made up: back to back.
  const lines = song([[40.06, 9], [41.6, 10], [43.33, 9], [44.94, 10], [46.36, 13], [47.99, 13], [49.58, 18], [52.8, 13], [54.39, 11], [56.06, 13], [57.34, 17], [59.59, 12], [60.79, 26], [64.53, 14]]);
  for (let i = 0; i + 1 < lines.length; i++) {
    // The last moment line i is the one lit: just before activeLine moves on.
    const last = lines[i + 1].t - LEAD - 0.01;
    assert(activeLine(lines, last) === i, `line ${i} not lit at ${last}`);
    assert(litLetters(lines, i, last) === lines[i].text.length, `line ${i}: ${litLetters(lines, i, last).toFixed(1)} of ${lines[i].text.length} lit as it is given up`);
  }
});

test('the fill keeps up with the voice: measured on the voice alone (Demucs) in three songs, 0.35 s off at most on the whole', () => {
  // Per line: its time, the time to the next, its syllables, and when a quarter, half, three quarters and
  // the last of its syllables were heard (s after its time; the voice alone, 29.10.2026). No words kept.
  const songs: Record<string, number[][]> = {
    'The Creepshow (Night Club)': [[23.27, 2.62, 7, 0.15, 0.32, 1.38, 1.73], [25.89, 2.8, 7, 0.27, 0.84, 1.56, 1.81], [28.69, 5.5, 9, 0.79, 1.45, 2.5, 3.71], [34.19, 2.53, 7, 0.42, 1.07, 1.52, 2.32], [36.72, 2.71, 9, 0.39, 1.03, 1.03, 2.04], [39.43, 4.75, 9, 1.24, 2.09, 3.28, 4.17], [44.18, 2.37, 4, 0.74, 0.85, 1.43, 2.2], [46.55, 2.89, 6, 0.19, 0.5, 2.3, 2.55]],
    'Rap God': [[1.05, 3.68, 16, 1.49, 1.97, 2.62, 3.0], [4.73, 4.4, 12, 1.18, 2.43, 2.87, 3.89], [9.13, 2.51, 8, 0.31, 0.66, 1.55, 1.55], [11.64, 5.76, 22, 2.92, 3.39, 4.28, 5.39], [17.4, 3.3, 16, 0.55, 1.06, 2.02, 3.09], [20.7, 3.51, 19, 0.55, 1.14, 1.49, 2.88], [54.39, 1.67, 12, 0.4, 0.73, 1.11, 1.4], [56.06, 1.28, 13, 0.16, 0.57, 0.64, 0.95], [57.34, 2.25, 16, 0.33, 0.72, 1.54, 2.02], [59.59, 1.2, 10, -0.11, 0.29, 0.5, 0.91], [60.79, 3.74, 28, 0.91, 1.73, 2.49, 3.54], [64.53, 1.17, 14, -0.09, 0.33, 0.68, 0.88], [65.7, 1.77, 16, 0.16, 0.69, 1.04, 1.58], [67.47, 3.82, 22, 0.23, 1.33, 2.55, 3.61]],
    'Summertime (Beck)': [[7.32, 3.56, 13, 0.63, 1.65, 1.87, 3.28], [10.88, 2.79, 12, 1.11, 1.51, 1.51, 2.07], [13.67, 3.27, 12, 0.32, 1.89, 2.41, 2.91], [16.94, 5.52, 13, 0.5, 0.82, 1.62, 2.25], [22.46, 3.19, 5, 0.1, 0.32, 1.14, 1.14], [25.65, 3.09, 5, 0.09, 1.15, 2.31, 2.31]],
  };
  const all: number[] = [];
  for (const [name, rows] of Object.entries(songs)) {
    const off: number[] = [];
    for (const [t, gap, n, ...heard] of rows) {
      const lines = song([[t, n], [t + gap, 3]]);
      const length = lines[0].text.length;
      // When the fill shows each share of the line, on the screen's clock (litLetters), against the voice.
      [0.25, 0.5, 0.75, 1].forEach((share, k) => {
        let at = t - 1;
        while (at < t + gap && litLetters(lines, 0, at) < share * length - 0.5) at += 0.01;
        off.push(at - t - heard[k]);
      });
    }
    const late = median(off);
    const by = median(off.map(Math.abs));
    assert(by < 0.45 && Math.abs(late) < 0.3, `${name}: ${by.toFixed(2)} s off, ${late > 0 ? 'late' : 'early'} by ${Math.abs(late).toFixed(2)} s`);
    all.push(...off);
  }
  assert(median(all.map(Math.abs)) < 0.35 && Math.abs(median(all)) < 0.15, `on the whole ${median(all.map(Math.abs)).toFixed(2)} s off, ${median(all).toFixed(2)} s`);
});

test('a long gap after a line (a solo) is not crawled through: no slower than 0.45 s a syllable', () => {
  const solo = parseLrc('[00:10.00]Hello world\n[00:12.00]Next\n[00:13.00]Before a solo\n[01:00.00]After');
  // "Be-fo-re a so-lo": 6 syllables, 47 s to the next line.
  assert(sungLetters(solo, 2, 13 + 6 * 0.45 + 0.01) === 13, `${sungLetters(solo, 2, 15.7)}`);
  assert(sungLetters(solo, 0, 9) === 0 && sungLetters(solo, 0, 13) === 11, 'before / after');
});

test(`syllables, not letters: "medication" is four, "I'm" one; a second voice in brackets takes no time and lights with the line`, () => {
  assert(syllableWeights('medication').syllables === 4, 'medication');
  assert(syllableWeights("I'm don't").syllables === 2, "I'm don't");
  assert(syllableWeights('Группа крови').syllables === 4, 'Группа крови');
  const line = 'Something is wrong (six minutes, Slim Shady)';
  const { weights, syllables } = syllableWeights(line);
  // "Some-thing is wrong": a silent e counts (a guess, not a dictionary).
  assert(syllables === 5, `${syllables}`);
  assert(weights.slice(line.indexOf('(')).every((w) => w === 0), 'the brackets take time');
  // The line's own words sung, the brackets lit with its end.
  const lines = parseLrc(`[00:10.00]${line}\n[00:12.00]Next`);
  assert(sungLetters(lines, 0, 11.79) < line.indexOf('('), `${sungLetters(lines, 0, 11.79)}`);
  assert(sungLetters(lines, 0, 11.9) === line.length, `${sungLetters(lines, 0, 11.9)}`);
});

test("enhanced LRC: word by word, at each word's own time", () => {
  const lines = parseLrc('[00:10.00]<00:10.00>Du <00:11.00>hast <00:13.00>mich<00:14.00>\n[00:20.00]Next');
  assert(lines[0].text === 'Du hast mich' && lines[0].words?.length === 3, JSON.stringify(lines[0]));
  // "Du " is 3 letters, sung over 10–11 s; "hast " (5) over 11–13 s.
  assert(Math.abs(sungLetters(lines, 0, 10.5) - 1.5) < 0.01, `${sungLetters(lines, 0, 10.5)}`);
  assert(Math.abs(sungLetters(lines, 0, 12) - 5.5) < 0.01, `${sungLetters(lines, 0, 12)}`);
  // "mich" ends at its end stamp (14 s), not at the next line.
  assert(sungLetters(lines, 0, 14.5) >= 11, `${sungLetters(lines, 0, 14.5)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
