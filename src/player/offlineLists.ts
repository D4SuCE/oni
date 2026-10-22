// Lists kept for the offline mode, as in Yandex's app: with no network Liked and the playlists
// (albums too) with downloaded tracks still open, in their own order, and their downloaded tracks
// play from there; Downloads stays a page of its own. A list is written down when it is seen online.

import type { Playlist, Track } from '../api/types.ts';
import { loadJson, storage } from '../api/client.ts';
import { trimTrack } from './recent.ts';

export interface SavedList {
  title: string;
  tracks: Track[];
  /** The page's header: a playlist (cover, owner, …) or an album, without its tracks. */
  header?: object;
  at: number;
}

const KEY = 'offline.lists.v1';
const lists = loadJson<Record<string, SavedList>>(KEY, {});

/** Keeps the list under its key ("liked", "playlist:<uid>:<kind>", "album:<id>"). Writes only
 * when it changed: a long list is a lot to write on every look. */
export function saveList(key: string, title: string, tracks: Track[], header?: object) {
  const ids = tracks.map((t) => t.id).join();
  const old = lists[key];
  if (old && old.title === title && old.tracks.map((t) => t.id).join() === ids) return;
  lists[key] = { title, tracks: tracks.map(trimTrack), header: header && { ...header, tracks: undefined, volumes: undefined }, at: Date.now() };
  storage.setItem(KEY, JSON.stringify(lists));
}

export const savedList = (key: string): SavedList | undefined => lists[key];

/** A saved playlist as the API gives one, for its page. */
export function savedPlaylist(key: string): Playlist | null {
  const l = lists[key];
  if (!l?.header) return null;
  return { ...(l.header as Playlist), trackCount: l.tracks.length, tracks: l.tracks.map((track) => ({ id: track.id, track })) } as Playlist;
}
