// What a shared link points to: https://oni-music.github.io/#track/<id> (also #album/<id>,
// #artist/<id>, #playlist/<owner login>/<kind>, #listen/<room>/<folder> to listen together; made by
// shareUrl in src/ui/links.ts). The part after #
// never reaches the server. Gives the oni:// link that opens Oni and Yandex Music's own web link
// for a device without Oni; null for anything else. Checked by tests/links.test.ts.

export function route(hash) {
  const [kind, a, b] = String(hash).replace(/^#/, '').replace(/^\/+|\/+$/g, '').split('/');
  const num = (s) => /^\d+$/.test(s ?? '');
  if ((kind === 'track' || kind === 'album' || kind === 'artist') && num(a) && b === undefined)
    return { kind, oni: `oni://${kind}/${a}`, yandex: `https://music.yandex.ru/${kind}/${a}` };
  let owner;
  try {
    owner = decodeURIComponent(a ?? '');
  } catch {
    return null;
  }
  if (kind === 'playlist' && /^[\w.@-]+$/.test(owner) && num(b))
    return { kind, oni: `oni://playlist/${encodeURIComponent(owner)}/${b}`, yandex: `https://music.yandex.ru/users/${encodeURIComponent(owner)}/playlists/${b}` };
  // An invitation to listen together: Oni only (Yandex Music has nothing to open for it).
  if (kind === 'listen' && /^\w{8,64}$/.test(a ?? '') && /^[\w-]{4,64}$/.test(b ?? ''))
    return { kind, oni: `oni://listen/${a}/${b}`, yandex: null };
  return null;
}
