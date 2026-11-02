// "Share": a link to Oni's page (src/ui/links.ts, site/), which opens the track, album, artist or
// playlist in Oni, or in Yandex Music on a device without Oni.
// On the desktop it goes to the clipboard; on iOS the system share sheet takes it.

import type { Track } from '../api/types.ts';
import { storage, transport } from '../api/client.ts';
import { MADE_LINKS, uploadLink, useShare } from '../share/owner.ts';
import { LINKS } from '../share/shared.ts';
import { useSync } from '../sync/index.ts';
import { tr } from '../i18n.ts';
import { errorText, toast } from '../store.ts';
import { type OniLink, shareUrl } from './links.ts';

export async function share(link: OniLink, title: string, copied = tr().toast.linkCopied) {
  const url = shareUrl(link);
  if (transport.platform === 'ios' && navigator.share) {
    await navigator.share({ url, title }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(copied);
  } catch {
    toast(url);
  }
}

export function shareTrack(t: Track) {
  return share({ kind: 'track', id: String(t.id) }, t.title);
}

/** "Copy link" on one's own upload: its folder is made first (the Disk fetches the file, seconds). The
 * iPhone's share sheet opens only right on a tap, so a link not made yet waits for a press of its own. */
export async function shareUpload(t: Track, root = LINKS) {
  const s = tr().shared;
  if (!useSync.getState().connected) return toast(s.linkNeedsDisk);
  if (!useShare.getState().on) return toast(s.linkOff);
  const at = `${root}/${t.id}`;
  const made = (): Record<string, { key: string; names: string; until: number }> => JSON.parse(storage.getItem(MADE_LINKS) || '{}');
  const keep = (key: string, until: number) => storage.setItem(MADE_LINKS, JSON.stringify({ ...made(), [at]: { key, names, until } }));
  // renamed since: the name in its folder written anew
  const names = `${t.title}|${(t.artists ?? []).map((a) => a.name).join()}`;
  const saved = made()[at];
  if (saved?.names === names && saved.until > Date.now()) {
    // sent again: it lasts from now; the sheet does not wait for the Disk
    void uploadLink(t, root).then((l) => keep(l.key, l.until), () => {});
    return share({ kind: 'upload', key: saved.key }, t.title, s.linkCopied);
  }
  toast(s.linkMaking);
  let key: string;
  try {
    const l = await uploadLink(t, root);
    key = l.key;
    keep(key, l.until);
  } catch (e) {
    return toast(s.linkFailed(errorText(e)));
  }
  const link = { kind: 'upload', key } as const;
  if (transport.platform === 'ios') return toast(s.linkReady, { label: s.linkSend, run: () => void share(link, t.title) });
  return share(link, t.title, s.linkCopied);
}
