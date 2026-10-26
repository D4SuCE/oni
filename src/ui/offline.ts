// The interface side of downloads (src/player/offline.ts): re-rendering on changes, the
// "Download" actions with their progress, sizes for people.

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { Album, Playlist, Track } from '../api/types.ts';
import { ApiError, trackCover } from '../api/yandex.ts';
import { saveList, savedList } from '../player/offlineLists.ts';
import { api, storage } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { iosBackgroundDownloads, showProgressInShade, useTrackProgress } from '../player/iosDownloads.ts';
import { offline } from '../player/player.ts';
import { errorText, toast, useApp } from '../store.ts';
import { isIos } from './platform.ts';

/** Bumped on changes to the downloads; components read it to re-render. At most a few times a
 * second: a list of 500 downloading redrew on every file and every hand-over (heat on the phone). */
export const useOfflineVersion = create<{ v: number }>(() => ({ v: 0 }));
let bumping: ReturnType<typeof setTimeout> | null = null;
const bump = () => {
  bumping ??= setTimeout(() => {
    bumping = null;
    useOfflineVersion.setState((s) => ({ v: s.v + 1 }));
  }, 300);
};
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

/** Downloads came to the limit with nothing left to make room from: the iPhone's lists in the
 * background stop there (the desktop's stop by themselves, downloadAll). */
const fullToast = () => toast(tr().downloads.full(formatSize(offline!.space().limit)));
offline?.subscribe(() => {
  if (!offline!.full || !background?.progress().total) return;
  watched.clear();
  void background.cancelAll();
  fullToast();
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
    if (offline?.full) fullToast();
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
  if (!stopped && offline.full) return fullToast();
  toast(stopped ? tr().downloads.cancelled : failed ? tr().downloads.failedSome(failed) : tr().downloads.listDone(tracks.length));
}

export function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} ${tr().downloads.gb}` : `${Math.round(mb)} ${tr().downloads.mb}`;
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
    // a downloaded track Yandex has taken away is kept for good (player.ts, `playable`)
    if (tracks && !useApp.getState().offline) offline?.keepGone(tracks);
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

/**
 * A track's cover: Yandex's, or with no network the one kept with its download (the user: the song
 * played but its picture was missing). One kept size serves every place.
 */
export function useCover(track: Track | undefined, size: number) {
  const offlineNow = useApp((s) => s.offline);
  const id = track ? String(track.id) : '';
  const [local, setLocal] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!offlineNow || !id || !offline?.entry(id)?.cover) return;
    let alive = true;
    offline.coverUrl(id).then((url) => alive && url && setLocal({ id, url }));
    return () => {
      alive = false;
    };
  }, [offlineNow, id]);
  return offlineNow && local?.id === id ? local.url : trackCover(track, size);
}

/**
 * "Download new likes", as in Yandex's app: a track liked (here or on another device) downloads by
 * itself. Only those liked after switching it on: what was liked before downloads with Liked's
 * own Download. The ids already seen are kept, so a restart does not take every like for new.
 */
/** Downloads Yandex has taken away are kept for good (OfflineEntry.gone). A list showing one marks
 * it too (useKeepForOffline), but Yandex drops such a track from Liked as well (the user's "Pink
 * Blush", 26.10.2026), so every download is asked about once a start. */
export async function keepGoneDownloads() {
  if (!offline || useApp.getState().offline) return;
  const ids = offline.entries().map((e) => String(e.track.id)).filter((id) => /^\d+$/.test(id));
  if (!ids.length) return;
  const got = new Map((await api.tracks(ids)).map((t) => [String(t.id), t]));
  offline.keepGone(ids.map((id) => got.get(id) ?? ({ id, available: false } as Track)));
}

const AUTO_KEY = 'downloads.autoLikes';
const SEEN_KEY = 'downloads.autoLikes.seen';
/** A plain JSON value (loadJson is for objects: it merges them into the fallback). */
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const useAutoLikes = create<{ on: boolean }>(() => ({ on: readJson<boolean>(AUTO_KEY, false) === true }));
const likedIds = () => useApp.getState().likedKeys.map((k) => k.split(':')[0]);
const markSeen = (ids: string[]) => storage.setItem(SEEN_KEY, JSON.stringify(ids));

export function setAutoLikes(on: boolean) {
  useAutoLikes.setState({ on });
  storage.setItem(AUTO_KEY, JSON.stringify(on));
  if (on) markSeen(likedIds());
}

if (offline)
  useApp.subscribe((s, was) => {
    if (!useAutoLikes.getState().on || s.likedKeys === was.likedKeys || !s.libraryReady || s.offline) return;
    const seen = new Set(readJson<string[]>(SEEN_KEY, []));
    const fresh = s.likedKeys.filter((k) => !seen.has(k.split(':')[0]));
    markSeen(likedIds());
    const todo = fresh.filter((k) => !offline!.has(k.split(':')[0]));
    if (!todo.length) return;
    api
      .tracks(todo)
      .then((tracks) => tracks.forEach((t) => void downloadTrack(t)))
      .catch((e) => console.warn('new likes: not downloaded', e));
  });
