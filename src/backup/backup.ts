// A backup of the library on Yandex Disk (the user, 26.10.2026: "now it looks reasonable"): once a
// day the playlists — their names, descriptions and tracks in order — and Liked go to Oni's folder
// on the user's Disk, as backup/<date>.json; the last fortnight is kept. From Settings a playlist
// of one comes back (as a new playlist "… (copy of <date>)") or Liked gets back what left it. Own
// uploaded mp3s are kept by the shared folder (src/share), when sharing is on.

import { api, storage } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { visible } from '../share/mark.ts';
import { disk } from '../sync/index.ts';

export const FOLDER = 'backup';
const KEEP = 14;
const DONE = 'backup.day';

export interface BackupItem {
  id: string;
  albumId?: number;
}

export interface Backup {
  v: 1;
  at: number;
  likes: string[];
  playlists: { kind: number | string; title: string; description?: string; tracks: BackupItem[] }[];
}

/** "2026-10-26": a file a day. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const itemOf = (key: string): BackupItem => {
  const [id, album] = key.split(':');
  return album ? { id, albumId: Number(album) } : { id };
};

/** The library as it is now. */
export async function snapshot(now = Date.now()): Promise<Backup> {
  const likes = await api.likedTrackKeys();
  const playlists: Backup['playlists'] = [];
  for (const pl of await api.playlists()) {
    const full = await api.playlist(pl.uid, pl.kind, false);
    playlists.push({
      kind: pl.kind,
      title: pl.title,
      description: visible(pl.description) || undefined,
      tracks: (full.tracks ?? []).map((i) => ({ id: String(i.id), ...(i.albumId ? { albumId: i.albumId } : {}) })),
    });
  }
  return { v: 1, at: now, likes, playlists };
}

/** Once a day (a device that made today's copy does not make it again); the oldest beyond a
 * fortnight go. Quietly: a backup that fails is tried the next day. */
export async function backUp(now = Date.now()) {
  const day = dayOf(now);
  if (storage.getItem(DONE) === day) return false;
  await disk.mkdir(FOLDER);
  await disk.write(`${FOLDER}/${day}.json`, JSON.stringify(await snapshot(now)));
  storage.setItem(DONE, day);
  const days = (await list()).slice(KEEP);
  for (const d of days) await disk.remove(`${FOLDER}/${d}.json`);
  return true;
}

/** The days there are copies of, the newest first. */
export async function list(): Promise<string[]> {
  return (await disk.folder(FOLDER))
    .map((f) => f.name.replace(/\.json$/, ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
}

export async function read(day: string): Promise<Backup> {
  const b = JSON.parse(await disk.read(`${FOLDER}/${day}.json`)) as Backup;
  if (b?.v !== 1) throw new Error('not a backup of Oni');
  return b;
}

/** A playlist of a copy, as a new playlist (the one there now is left as it is). */
export async function restorePlaylist(b: Backup, kind: number | string, title: string): Promise<Playlist> {
  const pl = b.playlists.find((p) => String(p.kind) === String(kind));
  if (!pl) throw new Error('no such playlist in the copy');
  let made = await api.createPlaylist(title);
  if (pl.description) made = await api.setPlaylistDescription(made.kind, pl.description);
  const tracks = pl.tracks.map((x) => ({ id: x.id, albums: x.albumId ? [{ id: x.albumId }] : [] }) as unknown as Track);
  for (let i = 0; i < tracks.length; i += 100) made = await api.addToPlaylist(made, tracks.slice(i, i + 100), made.trackCount ?? i);
  return made;
}

/** What a copy's Liked had and Liked has not now: liked again. How many. */
export async function restoreLikes(b: Backup): Promise<number> {
  const now = new Set((await api.likedTrackKeys()).map((k) => k.split(':')[0]));
  const back = b.likes.filter((k) => !now.has(itemOf(k).id));
  for (let i = 0; i < back.length; i += 100) await api.setLiked(back.slice(i, i + 100), true);
  return back.length;
}
