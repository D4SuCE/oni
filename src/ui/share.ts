// "Share": a music.yandex.ru link, which opens the track in any Yandex Music app or the browser.
// On the desktop it goes to the clipboard; on iOS the system share sheet takes it.

import type { Track } from '../api/types.ts';
import { transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { toast } from '../store.ts';

export function trackUrl(t: Track) {
  const album = t.albums?.[0]?.id;
  return album ? `https://music.yandex.ru/album/${album}/track/${t.id}` : `https://music.yandex.ru/track/${t.id}`;
}

export async function shareTrack(t: Track) {
  const url = trackUrl(t);
  if (transport.platform === 'ios' && navigator.share) {
    await navigator.share({ url, title: t.title }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(tr().toast.linkCopied);
  } catch {
    toast(url);
  }
}
