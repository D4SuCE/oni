// Offline tests for shared uploads (src/share): the hidden mark in a playlist's description, a
// shared track as the player takes it, the file name "+ Mine" uploads it under.
// Run: npm run test:share
import { readMark, visible, withMark } from '../src/share/mark.ts';
import { trimTrack } from '../src/player/recent.ts';
import { asTrack, fileName, shareLinkOf } from '../src/share/shared.ts';

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
  assert(t.id === 'share-abc-1' && t.share?.file === 'abc-1.mp3' && t.share.link === LINK && t.share.owner === 'Друг', JSON.stringify(t));
  assert(t.artists.map((a) => a.name).join('|') === 'Автор|Второй' && t.durationMs === 200000, 'artists, length');
});

test("a shared track kept (History, downloads, the queue, the remote) is still a friend's upload", () => {
  // The user's picture, 27.10.2026: "Add to playlist" on one said "Parameters requirements are not
  // met" — kept without its share it had Yandex's menu, and Yandex knows no "share-…" track.
  const t = trimTrack(asTrack({ id: 'abc-1', file: 'abc-1.mp3', title: 'Песня', artists: ['Автор'], durationMs: 200000 }, LINK, 'Друг'));
  assert(t.share?.file === 'abc-1.mp3' && t.share.link === LINK && t.share.owner === 'Друг' && t.trackSource === 'SHARE', JSON.stringify(t));
});

test('"+ Mine" names the file "Artist - Title.mp3", with nothing a file name cannot have', () => {
  const t = asTrack({ id: 'x', file: 'x.mp3', title: 'A/B: "C"?', artists: ['D|E'], durationMs: 1 }, LINK, '');
  assert(fileName(t) === 'D E - A B C.mp3', fileName(t));
});

await test("the owner's folder from any playlist of theirs: its own mark, or another playlist's (their Liked has no description)", async () => {
  // The user, 26.10.2026: a friend likes one's main playlist, where Yandex shows them none of one's uploads.
  let asked = 0;
  const theirs = async () => (asked++, [{ kind: 3, description: '' }, { kind: 1005, description: withMark('Плейлист', LINK) }] as any);
  const marked = await shareLinkOf({ uid: 1, kind: 1005, owner: { uid: 1 }, description: withMark('', LINK) } as any, theirs);
  assert(marked === LINK && asked === 0, 'its own mark, nothing asked');
  const liked = await shareLinkOf({ uid: 1, kind: 3, owner: { uid: 1 } } as any, theirs);
  const again = await shareLinkOf({ uid: 1, kind: 1004, owner: { uid: 1 } } as any, theirs);
  assert(liked === LINK && again === LINK && asked === 1, `from another playlist, asked once: ${liked}, ${asked}`);
  const none = await shareLinkOf({ uid: 2, kind: 3, owner: { uid: 2 } } as any, async () => [{ kind: 1 }] as any);
  assert(none === null, 'nobody shares');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
