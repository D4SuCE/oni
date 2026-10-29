// Offline tests for picking LRCLIB's lyrics (src/player/lrclib.ts): the song of the track's length,
// synced first; covers, live takes and instrumentals left out.
// Run: npm run test:lyrics
import { pickLrclib } from '../src/player/lrclib.ts';
import { activeLine, LEAD, litLetters, parseLrc, songPace, sungLetters } from '../src/player/lrc.ts';

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

test("a line with no word times fills at the song's pace, not over a pause after it (the user: words lagged behind the voice)", () => {
  // The times and line lengths of Night Club's "The Creepshow" (its opening), the words made up.
  const opening: [number, number][] = [[23.27, 17], [25.89, 18], [28.69, 31], [34.19, 21], [36.72, 22], [39.43, 34], [44.18, 20], [46.55, 29], [49.44, 24], [51.9, 22], [54.99, 20]];
  const lines = parseLrc(opening.map(([t, n]) => `[00:${t.toFixed(2).padStart(5, '0')}]${'x'.repeat(n)}`).join('\n'));
  // A 31-letter line with 5.5 s to the next one is sung in about 3 s: lit whole by then, not half.
  assert(sungLetters(lines, 2, 28.69 + 3.2) === 31, `${sungLetters(lines, 2, 28.69 + 3.2)} of 31 at 3.2 s`);
  // Back to back, each line is done before the next begins.
  for (const i of [0, 1, 3, 6]) assert(sungLetters(lines, i, lines[i + 1].t - 0.05) === lines[i].text.length, `line ${i} not done`);
  assert(sungLetters(lines, 2, 28.6) === 0, 'before the line');
});

test('a line is lit whole by the moment the next one takes over (the user: the last words of a line were eaten)', () => {
  // Times and line lengths of Eminem's "Rap God" (its quick part), the words made up: lines back to back.
  const quick: [number, number][] = [[40.06, 32], [41.6, 36], [43.33, 35], [44.94, 34], [46.36, 43], [47.99, 43], [49.58, 66], [52.8, 44], [54.39, 37], [56.06, 47], [57.34, 60], [59.59, 40], [60.79, 92], [64.53, 49]];
  const lines = parseLrc(quick.map(([t, n]) => `[00:${t.toFixed(2).padStart(5, '0')}]${'x'.repeat(n)}`).join('\n'));
  for (let i = 0; i + 1 < lines.length; i++) {
    // The last moment line i is the one lit: just before activeLine moves on.
    const last = lines[i + 1].t - LEAD - 0.01;
    assert(activeLine(lines, last) === i, `line ${i} not lit at ${last}`);
    assert(litLetters(lines, i, last) === lines[i].text.length, `line ${i}: ${litLetters(lines, i, last).toFixed(1)} of ${lines[i].text.length} lit as it is given up`);
  }
});

test('the pace: a fast song fills fast, a slow one no slower than 0.13 s a letter; a long solo is not crawled through', () => {
  const song = (perLetter: number) => parseLrc(Array.from({ length: 8 }, (_, i) => `[00:${String(10 + i * 2).padStart(2, '0')}.00]${'x'.repeat(Math.round(2 / perLetter))}`).join('\n'));
  assert(Math.abs(songPace(song(0.06)) - 0.048) < 0.01, `fast: ${songPace(song(0.06))}`);
  assert(songPace(song(0.5)) === 0.13, `slow: ${songPace(song(0.5))}`);
  const solo = parseLrc('[00:10.00]Hello world\n[00:12.00]Next\n[00:13.00]Before a solo\n[01:00.00]After');
  assert(sungLetters(solo, 2, 13 + 13 * 0.13 + 0.01) === 13, `${sungLetters(solo, 2, 15)}`);
  assert(sungLetters(solo, 0, 9) === 0 && sungLetters(solo, 0, 13) === 11, 'before / after');
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
