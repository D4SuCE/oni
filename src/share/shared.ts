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
  /** Its place in the playlist: the nearest of Yandex's tracks above it, null when none is. Yandex
   * shows a friend the playlist without the uploads, so this is what puts them back (`withUploads`). */
  after?: string | null;
  /** Its cover (`coverUri`): opens for anyone. */
  cover?: string;
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

/** A link to one upload (the user, 2.11.2026: "send him a link to the song"): an open folder of its
 * own, with only that track, so a link passed on opens nothing else, and a track of a private playlist
 * can go too. The owner's side: `uploadLink` (owner.ts). */
export const LINKS = 'links';
export const LINK_FILE = 'track.mp3';
export const LINK_INFO = 'info.json';
/** How long a link lasts from its last sending (the user, 2.11.2026: the copy must not stay for good). */
export const LINK_LIFE = 7 * 24 * 3600 * 1000;

export interface LinkDisk {
  folders(path: string): Promise<string[]>;
  folder(path: string): Promise<{ name: string }[]>;
  read(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}

/** The links past their time go, the copy of the track with them. A folder whose info cannot be read
 * now stays until a later look; only the owner's Oni can do this, so `trackByLink` also goes by the time. */
export async function sweepLinks(disk: LinkDisk, root: string, now = Date.now()) {
  for (const name of await disk.folders(root)) {
    const folder = `${root}/${name}`;
    try {
      // the info goes up first (uploadLink): with none, the link was never made whole
      if ((await disk.folder(folder)).some((f) => f.name === LINK_INFO)) {
        const until = Number(JSON.parse(await disk.read(`${folder}/${LINK_INFO}`))?.until);
        if (until > now) continue;
      }
      await disk.remove(folder);
    } catch {
      // no answer, or not read: not a reason to remove it
    }
  }
}

/** The track a link's folder holds. */
export async function trackByLink(link: string, fetch: Fetch): Promise<Track> {
  const url = await sharedFileUrl(link, LINK_INFO, fetch);
  const r = await fetch<string>({ url, responseType: 'text' });
  if (!r.ok) throw new Error(`the link's info did not come (${r.status})`);
  const info = JSON.parse(r.data);
  const x = info?.track;
  if (!(Number(info?.until) > Date.now())) throw new Error('the link is past its time');
  // the id names a downloaded file (asTrack): [\w-] only
  if (info?.v !== 1 || typeof x?.title !== 'string' || !/^[\w-]{1,64}$/.test(String(x?.id))) throw new Error('not a link of Oni');
  const artists = Array.isArray(x.artists) ? x.artists.filter((a: unknown) => typeof a === 'string') : [];
  return asTrack({ ...x, artists, file: LINK_FILE, durationMs: Number(x.durationMs) || undefined }, link, String(info.owner ?? ''));
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
    // what a friend's file says goes no further than Yandex's own covers
    coverUri: t.cover?.startsWith('avatars.yandex.net/') ? t.cover : undefined,
    share: { link, file: t.file, owner },
  } as Track;
}

export const fileOf = (t: Track) => `${t.id}.mp3`;

/** A playlist's uploads as its index lists them, each with its place among the other tracks. */
export function sharedTracks(all: Track[]): SharedTrack[] {
  let after: string | null = null;
  const out: SharedTrack[] = [];
  for (const t of all) {
    if (t.trackSource !== 'UGC') {
      after = String(t.id);
      continue;
    }
    out.push({ id: String(t.id), file: fileOf(t), title: t.title, artists: (t.artists ?? []).map((a) => a.name), durationMs: t.durationMs, after, ...(t.coverUri ? { cover: t.coverUri } : {}) });
  }
  return out;
}

/** A friend's playlist as its owner has it (the user, 2.11.2026: "the same order, with the uploaded
 * tracks"): Yandex's list with the uploads back in their places. Yandex's list is the truth for its
 * own tracks: one added since the owner's last round is simply there, and an upload whose track above
 * has left (or is hidden from others: rights gone) stays beside the upload before it. An index from
 * before places were kept: the uploads after the list. */
export function withUploads(list: Track[], pl: SharedPlaylist | undefined, link: string, owner: string): Track[] {
  // a list kept for the offline mode has them in already
  const theirs = list.filter((t) => !t.share);
  const here = new Set(theirs.map((t) => String(t.id)));
  const END = Symbol('end');
  const places = new Map<string | symbol | null, Track[]>();
  let place: string | symbol | null = null;
  for (const x of pl?.tracks ?? []) {
    if (x.after === undefined) place = END;
    else if (x.after === null || here.has(x.after)) place = x.after;
    if (!places.has(place)) places.set(place, []);
    places.get(place)!.push(asTrack(x, link, owner));
  }
  // taken once: a track twice in the list has the uploads after it once
  const take = (at: string | symbol | null) => {
    const found = places.get(at) ?? [];
    places.delete(at);
    return found;
  };
  return [...take(null), ...theirs.flatMap((t) => [t, ...take(String(t.id))]), ...take(END)];
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
