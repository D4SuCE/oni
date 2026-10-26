// Shared uploads, the hidden mark: where a user's uploaded playlists lie (the public link of the
// "shared" folder in Oni's folder on their Yandex Disk), kept in the description of each of their
// playlists in zero-width characters — seen nowhere, in Oni or Yandex's apps, yet read by a friend's
// Oni from a playlist the user sent him (the user, 26.10.2026: "the link seen nowhere: one gets it
// only with my playlist's link, and even then hidden under the shell"). Pure: tested offline.

/** Starts and ends a mark (INVISIBLE SEPARATOR); the bits between are ZERO WIDTH SPACE (0) and
 * ZERO WIDTH NON-JOINER (1). Yandex keeps them as they are (checked 26.10.2026). */
const EDGE = String.fromCharCode(0x2063);
const ZERO = String.fromCharCode(0x200b);
const ONE = String.fromCharCode(0x200c);
const MARK = new RegExp(`${EDGE}[${ZERO}${ONE}]*${EDGE}`, 'g');
/** Inside the mark, before the link: a mark of this kind (and its version). */
const KIND = 'oni1:';

function encode(text: string) {
  const bits = [...new TextEncoder().encode(text)].map((b) => b.toString(2).padStart(8, '0')).join('');
  return EDGE + [...bits].map((b) => (b === '0' ? ZERO : ONE)).join('') + EDGE;
}

function decode(mark: string): string | null {
  const bits = Array.from(mark.slice(1, -1)).map((c) => (c === ZERO ? '0' : '1')).join('');
  if (!bits.length || bits.length % 8) return null;
  const bytes = Uint8Array.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The description as people see it: no mark. */
export function visible(description: string | undefined) {
  return (description ?? '').replace(MARK, '');
}

/** The description with the mark of `link` (any old mark replaced), or with none (`link` null). */
export function withMark(description: string | undefined, link: string | null) {
  const text = visible(description);
  return link ? text + encode(KIND + link) : text;
}

/** The link a description's mark holds, or null. */
export function readMark(description: string | undefined): string | null {
  for (const m of (description ?? '').match(MARK) ?? []) {
    const text = decode(m);
    if (text?.startsWith(KIND)) return text.slice(KIND.length);
  }
  return null;
}
