// Offline tests for picking LRCLIB's lyrics (src/player/lrclib.ts): the song of the track's length,
// synced first; covers, live takes and instrumentals left out.
// Run: npm run test:lyrics
import { pickLrclib } from '../src/player/lrclib.ts';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
