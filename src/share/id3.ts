// The title and artist written into an mp3 (its ID3v2 tag) before "+ Mine" uploads it: Yandex
// names an upload by the file's tag, else by the file's name ("Artist - Title.mp3" as the title —
// the user's picture, 27.10.2026). An owner's file often has no tag: he named it in Yandex.
// The tag's other frames (a cover, an album) are kept.

const enc = new TextEncoder();

/** A text frame: UTF-16 with a byte order mark (ID3v2.3 and 2.4 both read it). */
function textFrame(id: string, text: string, v4: boolean) {
  const body = new Uint8Array(3 + text.length * 2);
  body.set([1, 0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    body[3 + i * 2] = c & 0xff;
    body[4 + i * 2] = c >> 8;
  }
  return frame(id, body, v4);
}

function frame(id: string, body: Uint8Array, v4: boolean) {
  const out = new Uint8Array(10 + body.length);
  out.set(enc.encode(id));
  out.set(v4 ? syncsafe(body.length) : [body.length >>> 24, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff], 4);
  out.set(body, 10);
  return out;
}

const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const unsyncsafe = (b: Uint8Array, at: number) => (b[at] << 21) | (b[at + 1] << 14) | (b[at + 2] << 7) | b[at + 3];

/** The file with its title and artist set; the audio itself untouched. */
export function withTitle(data: ArrayBuffer, title: string, artist: string): ArrayBuffer {
  const b = new Uint8Array(data);
  let audio = 0;
  let v4 = false;
  const kept: Uint8Array[] = [];
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const version = b[3];
    const flags = b[5];
    audio = 10 + unsyncsafe(b, 6) + (flags & 0x10 ? 10 : 0);
    // frames read only from a plain 2.3 / 2.4 tag; any other is dropped whole (a new one in its place)
    if ((version === 3 || version === 4) && !(flags & 0xc0)) {
      v4 = version === 4;
      for (let at = 10; at + 10 <= audio - (flags & 0x10 ? 10 : 0); ) {
        const id = String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const size = v4 ? unsyncsafe(b, at + 4) : ((b[at + 4] << 24) | (b[at + 5] << 16) | (b[at + 6] << 8) | b[at + 7]) >>> 0;
        if (id !== 'TIT2' && id !== 'TPE1') kept.push(b.subarray(at, at + 10 + size));
        at += 10 + size;
      }
    }
  }
  const frames = [textFrame('TIT2', title, v4), ...(artist ? [textFrame('TPE1', artist, v4)] : []), ...kept];
  const size = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(10 + size + (b.length - audio));
  out.set([0x49, 0x44, 0x33, v4 ? 4 : 3, 0, 0, ...syncsafe(size)]);
  let at = 10;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  out.set(b.subarray(audio), at);
  return out.buffer;
}
