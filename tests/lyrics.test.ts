// Offline tests for picking LRCLIB's lyrics (src/player/lrclib.ts): the song of the track's length,
// synced first; covers, live takes and instrumentals left out.
// Run: npm run test:lyrics
import { pickLrclib } from '../src/player/lrclib.ts';
import { activeLine, LEAD, linePace, litLetters, parseLrc, sungLetters, syllableWeights, type LrcLine } from '../src/player/lrc.ts';

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

test("a line with no word times fills at the pace around it, not over a pause after it (the user: words lagged behind the voice)", () => {
  // The times of Night Club's "The Creepshow" (its opening) and about its lines' syllables, the words made up.
  const opening: [number, number][] = [[23.27, 5], [25.89, 6], [28.69, 9], [34.19, 6], [36.72, 6], [39.43, 10], [44.18, 4], [46.55, 7], [49.44, 7], [51.9, 6], [54.99, 4]];
  const lines = song(opening);
  // 9 syllables with 5.5 s to the next line are sung in about 3 s: lit whole by 3.4 s (it was 18 of 31 letters at 3.2 s).
  assert(sungLetters(lines, 2, 28.69 + 3.4) === lines[2].text.length, `${sungLetters(lines, 2, 28.69 + 3.4)} of ${lines[2].text.length} at 3.4 s`);
  // Back to back, each line is done before the next begins.
  for (const i of [0, 1, 3, 6]) assert(sungLetters(lines, i, lines[i + 1].t - 0.05) === lines[i].text.length, `line ${i} not done`);
  assert(sungLetters(lines, 2, 28.6) === 0, 'before the line');
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

test('the pace follows the song: slow where it is slow, quick in the quick part (Rap God), and no crawling through a solo', () => {
  // Ten slow lines (0.45 s a syllable), then fourteen quick ones (0.12 s), back to back.
  const slow = Array.from({ length: 10 }, (_, i) => [10 + i * 4.5, 10] as [number, number]);
  const quick = Array.from({ length: 14 }, (_, i) => [55 + i * 1.8, 15] as [number, number]);
  const lines = song([...slow, ...quick]);
  assert(linePace(lines, 2) > 0.3, `slow part: ${linePace(lines, 2)}`);
  assert(linePace(lines, 18) < 0.13, `quick part: ${linePace(lines, 18)}`);
  // The quick part does not race through the slow one: half way through a slow line, about half of it.
  const half = sungLetters(lines, 3, lines[3].t + 2);
  assert(half > lines[3].text.length * 0.3 && half < lines[3].text.length * 0.7, `${half} of ${lines[3].text.length}`);
  const solo = parseLrc('[00:10.00]Hello world\n[00:12.00]Next\n[00:13.00]Before a solo\n[01:00.00]After');
  // "Be-fo-re a so-lo": 6 syllables at the slowest pace, then lit (47 s to the next line).
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
