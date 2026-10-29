// A playlist's menu without opening it: a right click on its card or its line in the side panel,
// a held finger on the iPhone (src/ui/longPress.ts sends the right click). What its page's buttons
// do (the user, 29.10.2026: "to do something with it without going in"). The tracks are loaded
// when an item needs them.

import { Download, Heart, Pencil, Play, Radio, Share, Shuffle, Trash2 } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { tr } from '../i18n.ts';
import { offline, playRadio, playShuffled, playTracks } from '../player/player.ts';
import { back, errorText, isOwn, refreshPlaylists, samePlaylist, toast, togglePlaylistLike, useApp } from '../store.ts';
import { downloadList } from '../ui/offline.ts';
import { share } from '../ui/share.ts';
import { askText, confirmDialog } from './Dialog.tsx';
import type { MenuItem } from './Menu.tsx';

async function tracksOf(pl: Playlist): Promise<Track[]> {
  const full = await api.playlist(pl.uid, pl.kind);
  return (full.tracks || []).map((i) => i.track).filter((t): t is Track => Boolean(t));
}

/** "Rename" on its page and in its menu: the new title, or null when left as it was. */
export async function renamePlaylist(pl: Playlist) {
  const title = await askText(tr().playlist.renameTitle, pl.title, tr().common.save);
  if (!title || title === pl.title) return null;
  const updated = await api.renamePlaylist(pl.kind, title);
  refreshPlaylists();
  return updated.title;
}

/** "Delete" on its page and in its menu, after asking; its page, if open, is left. */
export async function deletePlaylist(pl: Playlist) {
  if (!(await confirmDialog(tr().playlist.deleteTitle, tr().playlist.deleteMessage(pl.title)))) return;
  await api.deletePlaylist(pl.kind);
  await refreshPlaylists();
  const route = useApp.getState().route;
  if (route.name === 'playlist' && samePlaylist(route, pl)) back();
}

export function playlistMenu(pl: Playlist): MenuItem[] {
  const t = tr();
  const from = { playlist: `${pl.uid}:${pl.kind}` };
  // A failed load or call says why, as the page does.
  const run = (what: (tracks: Track[]) => unknown) => async () => {
    try {
      const tracks = await tracksOf(pl);
      if (tracks.length) await what(tracks);
    } catch (e) {
      toast(errorText(e));
    }
  };
  const saved = useApp.getState().likedPlaylists.some((p) => samePlaylist(p, pl));
  // One's own "Liked" (kind 3) is neither renamed nor deleted; a friend's can be saved.
  const ownLiked = isOwn(pl) && Number(pl.kind) === 3;
  return [
    { label: t.common.play, icon: <Play size={15} />, onClick: run((tracks) => playTracks(tracks, 0, pl.title, from)) },
    { label: t.common.shuffle, icon: <Shuffle size={15} />, onClick: run((tracks) => playShuffled(tracks, pl.title, from)) },
    { label: t.common.radio, icon: <Radio size={15} />, onClick: () => playRadio(`playlist:${pl.uid}:${pl.kind}`, pl.title) },
    ...(offline
      ? [{ label: t.menu.download, icon: <Download size={15} />, onClick: run((tracks) => downloadList(`playlist:${pl.uid}:${pl.kind}`, tracks.filter((x) => x.available !== false), pl.title)) }]
      : []),
    { label: t.menu.share, icon: <Share size={15} />, onClick: () => share({ kind: 'playlist', owner: pl.owner?.login || String(pl.uid), id: String(pl.kind) }, pl.title) },
    ...(ownLiked ? [] : [{ label: '', separator: true }]),
    ...(ownLiked
      ? []
      : isOwn(pl)
      ? [
          { label: t.playlist.rename, icon: <Pencil size={15} />, onClick: () => renamePlaylist(pl).catch((e) => toast(errorText(e))) },
          { label: t.playlist.delete, icon: <Trash2 size={15} />, danger: true, onClick: () => deletePlaylist(pl).catch((e) => toast(errorText(e))) },
        ]
      : [{ label: saved ? t.playlist.unsave : t.playlist.save, icon: <Heart size={15} />, onClick: () => togglePlaylistLike(pl) }]),
  ];
}
