// Links into the app (src/ui/links.ts): what an iPhone shortcut sends.
// Run: npm run test:links
import { searchFromLink } from '../src/ui/links.ts';

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
function eq(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

test('the shortcut\'s link: plus signs are spaces', () => {
  eq(searchFromLink('oni://search?text=Кино+Группа+крови'), 'Кино Группа крови');
});
test('percent-encoded text, as iOS may send it', () => {
  eq(searchFromLink('oni://search?text=%D0%9A%D0%B8%D0%BD%D0%BE%20World'), 'Кино World');
});
test('spaces collapse and trim; empty text is no search', () => {
  eq(searchFromLink('oni://search?text=++a+++b++'), 'a b');
  eq(searchFromLink('oni://search?text='), null);
  eq(searchFromLink('oni://search'), null);
});
test('other spellings of the same link', () => {
  eq(searchFromLink('oni:search?text=x'), 'x');
  eq(searchFromLink('oni:///search?text=x'), 'x');
  eq(searchFromLink('ONI://Search?q=x'), 'x');
});
test('not ours: other schemes and other commands', () => {
  eq(searchFromLink('yandexmusic://search?text=x'), null);
  eq(searchFromLink('oni://play?text=x'), null);
  eq(searchFromLink('not a url'), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
