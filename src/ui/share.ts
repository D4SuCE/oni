// "Share": a link to Oni's page (src/ui/links.ts, site/), which opens the track, album, artist or
// playlist in Oni, or in Yandex Music on a device without Oni.
// On the desktop it goes to the clipboard; on iOS the system share sheet takes it.

import type { Track } from '../api/types.ts';
import { transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { toast } from '../store.ts';
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
