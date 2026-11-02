// Offline tests for shared uploads (src/share): the hidden mark in a playlist's description, a
// shared track as the player takes it, the file name "+ Mine" uploads it under.
// Run: npm run test:share
import { readMark, visible, withMark } from '../src/share/mark.ts';
import { YandexMusic } from '../src/api/yandex.ts';
import { trimTrack } from '../src/player/recent.ts';
import { withTitle } from '../src/share/id3.ts';
import { asTrack, fileName, shareLinkOf, sharedTracks, sweepLinks, trackByLink, withUploads } from '../src/share/shared.ts';

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

test("a friend's playlist: the uploads in the owner's places, between Yandex's tracks", () => {
  // The user, 2.11.2026: "the same order, with the uploaded tracks". Uploads first, between, last.
  const up = (id: string) => ({ id, title: id, artists: [], trackSource: 'UGC', coverUri: `avatars.yandex.net/c/${id}` }) as any;
  const cat = (id: string) => ({ id, title: id, artists: [] }) as any;
  const owner = [up('u1'), up('u2'), cat('1'), up('u3'), cat('2'), cat('3'), up('u4')];
  const index = { kind: 3, title: 'x', tracks: sharedTracks(owner) };
  assert(index.tracks.map((x) => x.after).join() === ',,1,3', JSON.stringify(index.tracks.map((x) => x.after)));
  assert(index.tracks[0].file === 'u1.mp3' && index.tracks[0].cover === 'avatars.yandex.net/c/u1', 'file, cover');
  const ids = (l: any[]) => l.map((t) => String(t.id).replace('share-', '')).join();
  const friend = [cat('1'), cat('2'), cat('3')];
  const whole = withUploads(friend, index, LINK, 'Друг');
  assert(ids(whole) === ids(owner), ids(whole));
  assert(whole[0].share?.link === LINK && whole[0].coverUri === 'avatars.yandex.net/c/u1' && !whole[2].share, 'an upload is a shared one, a catalog track stays Yandex\'s');
  // a track added since the owner's last round keeps Yandex's place; one gone: its upload stays beside the one before
  assert(ids(withUploads([cat('9'), cat('1'), cat('3')], index, LINK, '')) === 'u1,u2,9,1,u3,3,u4', ids(withUploads([cat('9'), cat('1'), cat('3')], index, LINK, '')));
  assert(ids(withUploads([cat('2'), cat('3')], index, LINK, '')) === 'u1,u2,u3,2,3,u4', ids(withUploads([cat('2'), cat('3')], index, LINK, '')));
  // kept for the offline mode with them in: not twice; a track twice in the list: its uploads once
  assert(ids(withUploads(whole, index, LINK, '')) === ids(owner), 'not twice');
  assert(ids(withUploads([cat('3'), cat('3')], index, LINK, '')) === 'u1,u2,u3,3,u4,3', ids(withUploads([cat('3'), cat('3')], index, LINK, '')));
  // an index from before places were kept: after the list; no such playlist in it: Yandex's list
  const old = { kind: 3, title: 'x', tracks: index.tracks.map((x) => ({ ...x, after: undefined })) };
  assert(ids(withUploads(friend, old, LINK, '')) === '1,2,3,u1,u2,u3,u4', ids(withUploads(friend, old, LINK, '')));
  assert(ids(withUploads(friend, undefined, LINK, '')) === '1,2,3', 'none');
});

test('a shared track: a cover only from Yandex\'s own host', () => {
  const at = (cover: string) => asTrack({ id: 'x', file: 'x.mp3', title: 't', artists: [], cover }, LINK, '').coverUri;
  assert(at('avatars.yandex.net/get-music-content/1/%%') === 'avatars.yandex.net/get-music-content/1/%%', 'Yandex\'s');
  assert(at('evil.example/x.png') === undefined, 'any other');
});

await test("a link to one upload: its folder's info is the track, playing from that folder; anything else is refused", async () => {
  // The user, 2.11.2026: "send him a link to the song, and it opens in Oni".
  const read = (info: unknown, ok = true) =>
    trackByLink(LINK, (async (req: any) => (req.query ? { ok: true, status: 200, data: { href: 'https://file/' } } : { ok, status: ok ? 200 : 404, data: JSON.stringify(info) })) as any);
  const until = Date.now() + 60_000;
  const t = await read({ v: 1, owner: 'Друг', until, track: { id: 'abc-1', title: 'Песня', artists: ['Автор', 5], durationMs: 200000, cover: 'avatars.yandex.net/c/%%' } });
  assert(t.id === 'share-abc-1' && t.share?.file === 'track.mp3' && t.share.link === LINK && t.share.owner === 'Друг', JSON.stringify(t));
  assert(t.artists.map((a) => a.name).join() === 'Автор' && t.durationMs === 200000 && t.coverUri === 'avatars.yandex.net/c/%%', JSON.stringify(t));
  const track = { id: 'a', title: 't' };
  for (const bad of [{ v: 2, until, track }, { v: 1, until }, { v: 1, until, track: { id: '../x', title: 't' } }, { v: 1, until, track: { id: 'a' } }, { v: 1, track }, { v: 1, until: Date.now() - 1, track }]) {
    const refused = await read(bad).then(() => false, () => true);
    assert(refused, `took ${JSON.stringify(bad)}`);
  }
});

await test('links past their time go with their copy; the rest stay, and one not read now is not a reason to remove it', async () => {
  // It removes files on the user's Disk: run here over a Disk in memory. The user, 2.11.2026.
  const now = 1_000_000;
  const files: Record<string, string> = {
    'links/old/info.json': JSON.stringify({ until: now - 1 }),
    'links/old/track.mp3': 'x',
    'links/fresh/info.json': JSON.stringify({ until: now + 1 }),
    'links/fresh/track.mp3': 'x',
    'links/never/track.mp3': 'x',
    'links/noanswer/info.json': 'cannot be read',
    'links/nountil/info.json': '{}',
    'links/broken/info.json': 'not json',
  };
  const names = (path: string) => Object.keys(files).filter((f) => f.startsWith(`${path}/`)).map((f) => f.slice(path.length + 1));
  const disk = {
    folders: async (path: string) => [...new Set(names(path).map((f) => f.split('/')[0]))],
    folder: async (path: string) => names(path).map((name) => ({ name })),
    read: async (path: string) => {
      if (files[path] === 'cannot be read') throw new Error('no answer');
      return files[path];
    },
    remove: async (path: string) => {
      for (const f of Object.keys(files)) if (f.startsWith(`${path}/`)) delete files[f];
    },
  };
  await sweepLinks(disk, 'links', now);
  assert((await disk.folders('links')).sort().join() === 'broken,fresh,noanswer', (await disk.folders('links')).join());
  assert(files['links/fresh/track.mp3'] === 'x', 'a live link keeps its track');
  await sweepLinks({ ...disk, folders: async () => { throw new Error('no answer'); } }, 'links', now).catch(() => {});
  assert((await disk.folders('links')).length === 3, 'no answer: nothing goes');
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

// ID3v2 frames of a file, as text: { TIT2: 'Title', … } (UTF-16 with BOM or Latin-1).
function frames(buf: ArrayBuffer) {
  const b = new Uint8Array(buf);
  const out: Record<string, string> = {};
  if (String.fromCharCode(b[0], b[1], b[2]) !== 'ID3') return { out, audio: 0 };
  const v4 = b[3] === 4;
  const ss = (at: number) => (b[at] << 21) | (b[at + 1] << 14) | (b[at + 2] << 7) | b[at + 3];
  const audio = 10 + ss(6);
  for (let at = 10; at + 10 <= audio; ) {
    const id = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = v4 ? ss(at + 4) : (b[at + 4] << 24) | (b[at + 5] << 16) | (b[at + 6] << 8) | b[at + 7];
    const body = b.subarray(at + 10, at + 10 + size);
    out[id] = body[0] === 1 ? new TextDecoder('utf-16le').decode(body.subarray(3)) : new TextDecoder('latin1').decode(body.subarray(1));
    at += 10 + size;
  }
  return { out, audio };
}
const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4, 5]);

test("\"+ Mine\" writes the title and artist into the file (Yandex names an upload by them, else by the file's name)", () => {
  // The user's picture, 27.10.2026: "New Beat Order Seeko Robbe KROMA - Secret.mp3" as the title.
  const plain = withTitle(AUDIO.slice().buffer, 'Secret', 'New Beat Order/Seeko, Ёж 🎵');
  const f = frames(plain);
  assert(f.out.TIT2 === 'Secret' && f.out.TPE1 === 'New Beat Order/Seeko, Ёж 🎵', JSON.stringify(f.out));
  assert(new Uint8Array(plain).subarray(f.audio).join() === AUDIO.join(), 'the audio untouched');
  // a tagged file (2.4): its old title replaced, its album kept, the audio after it untouched
  const latin = (id: string, text: string) => [...id].map((c) => c.charCodeAt(0)).concat([0, 0, 0, text.length + 1, 0, 0, 0], [...text].map((c) => c.charCodeAt(0)));
  const tagged = [...latin('TIT2', 'old.mp3'), ...latin('TALB', 'Album')];
  const file = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, tagged.length, ...tagged, ...AUDIO]);
  const g = frames(withTitle(file.buffer, 'New', ''));
  assert(g.out.TIT2 === 'New' && g.out.TALB === 'Album' && !('TPE1' in g.out), JSON.stringify(g.out));
  assert(new Uint8Array(withTitle(file.buffer, 'New', '')).subarray(frames(withTitle(file.buffer, 'New', '')).audio).join() === AUDIO.join(), 'the audio after an old tag untouched');
  assert(fileName({ title: 'x_cc.mp3', artists: [] } as any) === 'x_cc.mp3', 'no second .mp3');
});

await test('an upload the server timed out on (HTTP 504): found in the playlist, or sent again through another server; three tries', async () => {
  // The user, 27.10.2026: "Upload failed: HTTP 504" on "+ Mine", through a VPN.
  const run = async (posts: number[], appearsAfter: number) => {
    let sent = 0;
    let looked = 0;
    const transport: any = {
      platform: 'node',
      async request(req: any) {
        if (req.url.endsWith('/account/status')) return { ok: true, status: 200, data: { result: { account: { uid: 7, login: 'x' } } } };
        if (req.url.includes('/loader/upload-url')) return { ok: true, status: 200, data: { 'post-target': 'https://up/', 'ugc-track-id': `u${sent + 1}` } };
        if (req.url === 'https://up/') {
          const status = posts[sent++];
          return { ok: status < 300, status, data: {} };
        }
        if (req.url.includes('/playlists/5')) return { ok: true, status: 200, data: { result: { kind: 5, tracks: ++looked >= appearsAfter ? [{ id: 'u1' }] : [] } } };
        throw new Error('unexpected ' + req.url);
      },
    };
    const api = new YandexMusic(transport);
    const r = await api.upload({ name: 'a.mp3', data: new ArrayBuffer(4) }, { uid: 7, kind: 5 } as any, async () => {}).then(
      (id) => ({ id }),
      (e) => ({ error: String(e?.message ?? e) }),
    );
    return { ...r, sent };
  };
  const found = await run([504], 2);
  assert('id' in found && found.id === 'u1' && found.sent === 1, `went in all the same: ${JSON.stringify(found)}`);
  const again = await run([504, 201], Infinity);
  assert('id' in again && again.id === 'u2' && again.sent === 2, `sent again: ${JSON.stringify(again)}`);
  const never = await run([504, 502, 504], Infinity);
  assert('error' in never && /504/.test(never.error) && never.sent === 3, `gave up: ${JSON.stringify(never)}`);
  const refused = await run([400], Infinity);
  assert('error' in refused && refused.sent === 1, `a refusal is final: ${JSON.stringify(refused)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
