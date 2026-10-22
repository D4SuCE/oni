// Base64 for binary data crossing the Capacitor bridge (files, HTTP bodies) and for keys.
// Audio files go through here a few megabytes at a time, on the thread that draws the page:
// the engine's own Uint8Array.fromBase64 / toBase64 where it has them (Safari 18.2+), and a
// plain loop otherwise. Uint8Array.from with a mapping callback per byte froze the iPhone's
// page on every downloaded track.

type Base64Native = {
  fromBase64?: (s: string) => Uint8Array;
};

export function toBase64(bytes: Uint8Array) {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as unknown as Base64Native).fromBase64;
  if (typeof native === 'function') return native(b64) as Uint8Array<ArrayBuffer>;
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
