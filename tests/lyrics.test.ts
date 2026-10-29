// Offline tests for picking LRCLIB's lyrics (src/player/lrclib.ts): the song of the track's length,
// synced first; covers, live takes and instrumentals left out.
// Run: npm run test:lyrics
import { pickLrclib } from '../src/player/lrclib.ts';
import { parseLrc, sungLetters } from '../src/player/lrc.ts';

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

test('a line with no word times fills evenly over the time it is likely sung, not over a long gap', () => {
  const lines = parseLrc('[00:10.00]Hello world\n[00:12.00]Next\n[00:13.00]Before a solo\n[01:00.00]After');
  // 11 letters over the 2 s to the next line: half way, half the letters.
  assert(Math.abs(sungLetters(lines, 0, 11) - 5.5) < 0.01, `${sungLetters(lines, 0, 11)}`);
  assert(sungLetters(lines, 0, 9) === 0 && sungLetters(lines, 0, 13) === 11, 'before / after');
  // 13 letters, 47 s to the next line: whole within about 13 × 0.13 × 1.6 ≈ 2.7 s (not crawling through the solo).
  assert(sungLetters(lines, 2, 16) === 13, `${sungLetters(lines, 2, 16)}`);
  assert(sungLetters(lines, 2, 13.5) > 1.5 && sungLetters(lines, 2, 13.5) < 3.5, `${sungLetters(lines, 2, 13.5)}`);
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
