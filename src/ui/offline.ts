// The interface side of downloads (src/player/offline.ts): re-rendering on changes, the
// "Download" actions with their progress, sizes for people.

import { create } from 'zustand';
import type { Track } from '../api/types.ts';
import { tr } from '../i18n.ts';
import { offline } from '../player/player.ts';
import { errorText, toast } from '../store.ts';

/** Bumped on every change to the downloads; components read it to re-render. */
export const useOfflineVersion = create<{ v: number }>(() => ({ v: 0 }));
offline?.subscribe(() => useOfflineVersion.setState((s) => ({ v: s.v + 1 })));

/** Whole-list downloads in progress, by list ("playlist:<uid>:<kind>", "album:<id>", …). */
export const useBatches = create<Record<string, { done: number; total: number }>>(() => ({}));

export type OfflineState = 'none' | 'busy' | 'done';
export const offlineState = (id: string | number): OfflineState => (offline?.has(id) ? 'done' : offline?.isDownloading(id) ? 'busy' : 'none');

export async function downloadTrack(t: Track) {
  try {
    await offline?.download(t);
  } catch (e) {
    toast(tr().downloads.failedOne(errorText(e)));
  }
}

/** Lists whose download was cancelled: they stop after the tracks under way. */
const cancelled = new Set<string>();

/**
 * Downloads a list, oldest first: Liked and playlists list the newest on top, so they go from
 * the bottom up (an album keeps its order). Asking again while it runs cancels it.
 */
export async function downloadList(key: string, tracks: Track[]) {
  if (!offline) return;
  if (useBatches.getState()[key]) {
    cancelled.add(key);
    return;
  }
  const ordered = key === 'liked' || key.startsWith('playlist:') ? [...tracks].reverse() : tracks;
  const have = tracks.filter((t) => offline!.has(t.id)).length;
  useBatches.setState({ [key]: { done: have, total: tracks.length } });
  const failed = await offline.downloadAll(ordered, (done, total) => useBatches.setState({ [key]: { done, total } }), 2, () => cancelled.has(key));
  const stopped = cancelled.delete(key);
  useBatches.setState((s) => {
    const { [key]: _, ...rest } = s;
    return rest;
  }, true);
  toast(stopped ? tr().downloads.cancelled : failed ? tr().downloads.failedSome(failed) : tr().downloads.listDone(tracks.length));
}

export function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} ${tr().downloads.gb}` : `${Math.round(mb)} ${tr().downloads.mb}`;
}
