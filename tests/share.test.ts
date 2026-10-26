// Offline tests for shared uploads (src/share): the hidden mark in a playlist's description, a
// shared track as the player takes it, the file name "+ Mine" uploads it under.
// Run: npm run test:share
import { readMark, visible, withMark } from '../src/share/mark.ts';
import { asTrack, fileName } from '../src/share/shared.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.stack || e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const LINK = 'https://yadi.sk/d/KW-tlYmg7h4mtg';
/** The mark's characters: zero width space and non-joiner, the invisible separator. */
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x200b, 0x200c, 0x2063)}]`);

test('the mark is read back, and people see the description as it was', () => {
  const d = withMark('Моё описание — с «кавычками»', LINK);
  assert(readMark(d) === LINK, `read ${readMark(d)}`);
  assert(visible(d) === 'Моё описание — с «кавычками»', JSON.stringify(visible(d)));
  // nothing visible was added: only zero-width characters
  assert(Array.from(d.slice('Моё описание — с «кавычками»'.length)).every((c) => INVISIBLE.test(c)), 'only zero-width characters');
});

test('a new mark takes the old one\'s place; none takes it away; no description is fine', () => {
  const once = withMark('Текст', 'https://yadi.sk/d/old');
  const again = withMark(once, LINK);
  assert(readMark(again) === LINK && (again.match(new RegExp(String.fromCharCode(0x2063), 'g')) ?? []).length === 2, 'one mark, the new one');
  assert(withMark(again, null) === 'Текст' && readMark(withMark(again, null)) === null, 'taken away');
  assert(readMark(withMark(undefined, LINK)) === LINK && visible(withMark(undefined, LINK)) === '', 'no description');
  assert(readMark('Обычное описание') === null && readMark(undefined) === null, 'none');
});

test('a shared track: not Yandex\'s (its own id), its file and owner with it', () => {
  const t = asTrack({ id: 'abc-1', file: 'abc-1.mp3', title: 'Песня', artists: ['Автор', 'Второй'], durationMs: 200000 }, LINK, 'Друг');
  assert(t.id === 'share:abc-1' && t.share?.file === 'abc-1.mp3' && t.share.link === LINK && t.share.owner === 'Друг', JSON.stringify(t));
  assert(t.artists.map((a) => a.name).join('|') === 'Автор|Второй' && t.durationMs === 200000, 'artists, length');
});

test('"+ Mine" names the file "Artist - Title.mp3", with nothing a file name cannot have', () => {
  const t = asTrack({ id: 'x', file: 'x.mp3', title: 'A/B: "C"?', artists: ['D|E'], durationMs: 1 }, LINK, '');
  assert(fileName(t) === 'D E - A B C.mp3', fileName(t));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
