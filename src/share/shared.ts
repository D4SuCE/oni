// Shared uploads (the user, 26.10.2026): a user's own uploaded tracks, which Yandex lets only him
// play, reach a friend through the user's Yandex Disk. The user's Oni keeps every playlist of his
// with uploads in it in the "shared" folder of Oni's folder on his Disk — the tracks' files and
// index.json — and opens that folder by a link, kept hidden in his playlists' descriptions
// (mark.ts). A friend's Oni finds it in a playlist of his, and shows those playlists with the
// tracks: they play from the Disk, and "+ Mine" puts one into a playlist of the friend's own (as
// his own upload). This file: the folder's index, and reading it by its link (no sign-in needed).

import type { HttpRequest, HttpResponse } from '../api/transport.ts';
import type { Playlist, Track } from '../api/types.ts';
import { readMark } from './mark.ts';

/** Oni's folder on the Disk: the shared one inside it. */
export const SHARED = 'shared';
export const INDEX = 'index.json';

export interface SharedTrack {
  /** The file in the folder (`<the upload's id>.mp3`). */
  file: string;
  title: string;
  artists: string[];
  durationMs?: number;
  /** The owner's upload, in Yandex: the same track in two playlists is one file. */
  id: string;
}

export interface SharedPlaylist {
  kind: number | string;
  title: string;
  tracks: SharedTrack[];
}

export interface SharedIndex {
  v: 1;
  owner: { uid: number | string; name: string };
  /** When the folder was last brought up to date (ms). */
  updated: number;
  playlists: SharedPlaylist[];
  /** Tracks still going up (the owner's Oni is putting them there now); none when all are there. */
  pending?: number;
}

export type Fetch = <T = any>(req: HttpRequest) => Promise<HttpResponse<T>>;

const PUBLIC = 'https://cloud-api.yandex.net/v1/disk/public/resources';

/** A file of the shared folder: where to get it now (the address the Disk gives lasts hours). */
export async function sharedFileUrl(link: string, file: string, fetch: Fetch): Promise<string> {
  const r = await fetch<{ href?: string }>({ url: `${PUBLIC}/download`, query: { public_key: link, path: `/${file}` } });
  if (!r.ok || !r.data?.href) throw new Error(`the shared file is not there (${r.status})`);
  return r.data.href;
}

/** The shared folder's index, by its link. */
export async function readShared(link: string, fetch: Fetch): Promise<SharedIndex> {
  const url = await sharedFileUrl(link, INDEX, fetch);
  const r = await fetch<string>({ url, responseType: 'text' });
  if (!r.ok) throw new Error(`the shared index did not come (${r.status})`);
  const index = JSON.parse(r.data) as SharedIndex;
  if (index?.v !== 1 || !Array.isArray(index.playlists)) throw new Error('not a shared folder of Oni');
  return index;
}

/** A shared track as the player and the lists take it. */
export function asTrack(t: SharedTrack, link: string, owner: string): Track {
  return {
    // no colon: a download's file is named by the id (the desktop takes [\w-] only)
    id: `share-${t.id}`,
    title: t.title,
    artists: t.artists.map((name, i) => ({ id: -1 - i, name })),
    albums: [],
    durationMs: t.durationMs,
    trackSource: 'SHARE',
    share: { link, file: t.file, owner },
  } as Track;
}

export const isShared = (t: Track | undefined) => Boolean(t?.share);

/** A file name Yandex takes: "Artist - Title.mp3", no characters a file name cannot have. */
export function fileName(t: Track) {
  const artists = (t.artists ?? []).map((a) => a.name).join(', ');
  // a title that is still a file's name ("x.mp3") gets no second ".mp3"
  return `${artists ? `${artists} - ` : ''}${t.title.replace(/\.mp3$/i, '')}`.replace(/[<>:"|?*\\]+/g, ' ').replaceAll('/', ' ').replace(/\s+/g, ' ').trim().slice(0, 150) + '.mp3';
}

const links = new Map<string, Promise<string | null>>();

/** The owner's shared folder, from any playlist of theirs: its own mark, or else one in another of
 * their playlists — their Liked has no description to hold it (the user, 26.10.2026: a friend on
 * one's Liked finds "Uploads" too). Asked once per owner. */
export function shareLinkOf(pl: Playlist, theirs: (uid: number | string) => Promise<Playlist[]>): Promise<string | null> {
  const own = readMark(pl.description);
  if (own) return Promise.resolve(own);
  const uid = pl.owner?.uid ?? pl.uid;
  if (uid === undefined) return Promise.resolve(null);
  let found = links.get(String(uid));
  if (!found) {
    found = theirs(uid).then((list) => list.map((p) => readMark(p.description)).find(Boolean) ?? null, () => null);
    links.set(String(uid), found);
    // none yet: asked again next time (the owner may switch sharing on in a minute)
    void found.then((l) => l || links.delete(String(uid)));
  }
  return found;
}
