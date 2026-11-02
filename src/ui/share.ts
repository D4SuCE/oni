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

export async function share(link: OniLink, title: string) {
  const url = shareUrl(link);
  if (transport.platform === 'ios' && navigator.share) {
    await navigator.share({ url, title }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(tr().toast.linkCopied);
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
  const made: Record<string, { key: string; names: string }> = JSON.parse(storage.getItem(MADE_LINKS) || '{}');
  const at = `${root}/${t.id}`;
  // renamed since: the name in its folder written anew
  const names = `${t.title}|${(t.artists ?? []).map((a) => a.name).join()}`;
  if (made[at]?.names === names) return share({ kind: 'upload', key: made[at].key }, t.title);
  toast(s.linkMaking);
  let key: string;
  try {
    key = await uploadLink(t, root);
  } catch (e) {
    return toast(s.linkFailed(errorText(e)));
  }
  storage.setItem(MADE_LINKS, JSON.stringify({ ...made, [at]: { key, names } }));
  const link = { kind: 'upload', key } as const;
  if (transport.platform === 'ios') return toast(s.linkReady, { label: s.linkSend, run: () => void share(link, t.title) });
  return share(link, t.title);
}
