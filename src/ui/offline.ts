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

export async function downloadList(key: string, tracks: Track[]) {
  if (!offline || useBatches.getState()[key]) return;
  useBatches.setState({ [key]: { done: 0, total: tracks.length } });
  const failed = await offline.downloadAll(tracks, (done, total) => useBatches.setState({ [key]: { done, total } }));
  useBatches.setState((s) => {
    const { [key]: _, ...rest } = s;
    return rest;
  }, true);
  toast(failed ? tr().downloads.failedSome(failed) : tr().downloads.listDone(tracks.length));
}

export function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} ${tr().downloads.gb}` : `${Math.round(mb)} ${tr().downloads.mb}`;
}
