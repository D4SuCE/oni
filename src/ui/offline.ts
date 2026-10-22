// The interface side of downloads (src/player/offline.ts): re-rendering on changes, the
// "Download" actions with their progress, sizes for people.

import { useEffect } from 'react';
import { create } from 'zustand';
import type { Album, Playlist, Track } from '../api/types.ts';
import { ApiError } from '../api/yandex.ts';
import { saveList, savedList } from '../player/offlineLists.ts';
import { tr } from '../i18n.ts';
import { iosBackgroundDownloads, showProgressInShade, useTrackProgress } from '../player/iosDownloads.ts';
import { offline } from '../player/player.ts';
import { errorText, toast, useApp } from '../store.ts';
import { isIos } from './platform.ts';

/** Bumped on every change to the downloads; components read it to re-render. */
export const useOfflineVersion = create<{ v: number }>(() => ({ v: 0 }));
const bump = () => useOfflineVersion.setState((s) => ({ v: s.v + 1 }));
offline?.subscribe(bump);

/** The iPhone downloads lists in the background, through iOS (player/iosDownloads.ts). */
export const background = isIos && offline ? iosBackgroundDownloads() : null;
background?.subscribe(bump);

/** Lists sent to the background, by key, with their size: a toast when each is through. */
const watched = new Map<string, number>();
background?.subscribe(() => {
  for (const [key, total] of watched)
    if (!background!.pendingFor(key)) {
      watched.delete(key);
      const failed = background!.failed[key];
      toast(failed ? tr().downloads.failedSome(failed) : tr().downloads.listDone(total));
    }
});

/** Whole-list downloads in progress, by list ("playlist:<uid>:<kind>", "album:<id>", …). */
export const useBatches = create<Record<string, { done: number; total: number }>>(() => ({}));

/** `busy`: being fetched now (the desktop's); `queued`: given to iOS, which fetches a few at a time. */
export type OfflineState = 'none' | 'queued' | 'busy' | 'done';
export const offlineState = (id: string | number): OfflineState =>
  offline?.has(id) ? 'done' : offline?.isDownloading(id) ? 'busy' : background?.isPending(id) ? 'queued' : 'none';

/** How far a track's download is (0…1) where it is known: the iPhone's, through iOS. */
export const useDownloadProgress = (id: string | number) => useTrackProgress((s) => s[String(id)]);

export async function downloadTrack(t: Track) {
  // The iPhone: through iOS too, sealed natively (no audio through the page) and with its ring.
  if (background) {
    showProgressInShade();
    await background.add(`track:${t.id}`, [t], t.title);
    return;
  }
  try {
    await offline?.download(t);
  } catch (e) {
    toast(tr().downloads.failedOne(errorText(e)));
  }
}

/** Lists whose download was cancelled: they stop after the tracks under way. */
const cancelled = new Set<string>();

/**
 * Downloads a list in its order, top first, as Yandex's app does (the user, 22.10.2026; it went
 * from the bottom up before). Asking again while it runs cancels it. `title`: for the progress
 * outside the app.
 */
export async function downloadList(key: string, tracks: Track[], title = '') {
  if (!offline) return;
  const ordered = tracks;
  if (background) {
    if (background.pendingFor(key)) {
      watched.delete(key);
      await background.cancel(key);
      toast(tr().downloads.cancelled);
    } else {
      watched.set(key, tracks.length);
      showProgressInShade();
      await background.add(key, ordered, title);
    }
    return;
  }
  if (useBatches.getState()[key]) {
    cancelled.add(key);
    return;
  }
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

/**
 * Keeps a list for the offline mode (player/offlineLists.ts) when seen online: Liked always,
 * others once some of their tracks are downloaded or on their way.
 */
export function useKeepForOffline(key: string, title: string, tracks: Track[] | null | undefined, header?: Playlist | Album) {
  useOfflineVersion((s) => s.v);
  const kept = Boolean(tracks?.length) && (key === 'liked' || tracks!.some((t) => offline?.has(t.id)) || Boolean(background?.pendingFor(key)));
  useEffect(() => {
    if (kept && tracks && !useApp.getState().offline) saveList(key, title, tracks, header);
  }, [kept, tracks, key, title, header]);
}

/** Loads a list, or with no network (or no answer) gives the kept one; none kept: says why. */
export async function loadOrKept<T>(load: () => Promise<T>, kept: () => T | null | undefined): Promise<T> {
  const fromKept = () => {
    const k = kept();
    if (k) return k;
    throw new Error(tr().downloads.notSaved);
  };
  if (useApp.getState().offline) return fromKept();
  try {
    return await load();
  } catch (e) {
    if (e instanceof ApiError || !kept()) throw e;
    return fromKept();
  }
}

export { savedList };
