// Links into the app (src/ui/links.ts): what an iPhone shortcut sends, what "Share" gives and the
// page it leads to (site/open.js). Run: npm run test:links
import { route } from '../site/open.js';
import { linkFrom, searchFromLink, shareUrl } from '../src/ui/links.ts';
import { isNewer } from '../src/ui/version.ts';

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

const same = (actual: unknown, expected: unknown) => eq(JSON.stringify(actual), JSON.stringify(expected));

test('oni:// links: track, album, artist, playlist', () => {
  same(linkFrom('oni://track/12345'), { kind: 'track', id: '12345' });
  same(linkFrom('oni://album/7/'), { kind: 'album', id: '7' }); // Windows adds a slash at the end
  same(linkFrom('oni://artist/9'), { kind: 'artist', id: '9' });
  same(linkFrom('oni://playlist/some.login/1005'), { kind: 'playlist', owner: 'some.login', id: '1005' });
  same(linkFrom('oni://playlist/a%40b.ru/3'), { kind: 'playlist', owner: 'a@b.ru', id: '3' });
});
test('not a link to anything: wrong ids, extra parts, other things', () => {
  eq(linkFrom('oni://track/abc'), null);
  eq(linkFrom('oni://track/1/2'), null);
  eq(linkFrom('oni://playlist/x'), null);
  eq(linkFrom('oni://playlist/x/y'), null);
  eq(linkFrom('oni://playlist/%E0%A4%A/1'), null); // broken escape: no crash
  eq(linkFrom('oni://search?text=x'), null);
  eq(linkFrom('oni://command?do=next'), null);
  eq(linkFrom('Кино Группа крови'), null);
  eq(linkFrom('https://example.com/track/1'), null);
  eq(linkFrom('file:///track/1'), null);
});
test('Yandex Music web links, pasted into Search', () => {
  same(linkFrom('https://music.yandex.ru/album/111/track/222'), { kind: 'track', id: '222' });
  same(linkFrom('https://music.yandex.ru/album/111/track/222?utm_source=desktop'), { kind: 'track', id: '222' });
  same(linkFrom('https://music.yandex.com/track/222'), { kind: 'track', id: '222' });
  same(linkFrom('  https://music.yandex.ru/album/111 '), { kind: 'album', id: '111' });
  same(linkFrom('https://music.yandex.by/artist/5/tracks'), { kind: 'artist', id: '5' });
  same(linkFrom('https://music.yandex.ru/users/music-blog/playlists/2774'), { kind: 'playlist', owner: 'music-blog', id: '2774' });
  eq(linkFrom('https://music.yandex.ru/home'), null);
});
test('Share gives the page; the page and the app read it the same way', () => {
  const links = [
    { kind: 'track', id: '222' },
    { kind: 'album', id: '111' },
    { kind: 'artist', id: '5' },
    { kind: 'playlist', owner: 'a@b.ru', id: '1005' },
  ] as const;
  for (const link of links) {
    const url = shareUrl(link);
    same(linkFrom(url), link);
    const r = route(new URL(url).hash);
    if (!r) throw new Error(`the page can't read ${url}`);
    same(linkFrom(r.oni), link); // the page's oni:// link opens the same thing in the app
    same(linkFrom(r.yandex), link); // and its Yandex link points to it too
  }
  eq(shareUrl({ kind: 'track', id: '222' }), 'https://oni-music.github.io/#track/222');
});
test('the page: nothing to open', () => {
  eq(route(''), null);
  eq(route('#'), null);
  eq(route('#track/'), null);
  eq(route('#track/1/2'), null);
  eq(route('#playlist/<script>/1'), null);
  eq(route('#playlist/%E0%A4%A/1'), null);
});

test('versions: the iPhone offers only a newer one', () => {
  eq(isNewer('1.5.6', '1.5.5'), true);
  eq(isNewer('1.5.10', '1.5.9'), true);
  eq(isNewer('1.6.0', '1.5.12'), true);
  eq(isNewer('1.5.5', '1.5.5'), false);
  eq(isNewer('1.5.4', '1.5.5'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
