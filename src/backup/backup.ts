// A backup of the library on Yandex Disk (the user, 26.10.2026: "now it looks reasonable"): once a
// day the playlists — their names, descriptions and tracks in order — and Liked go to Oni's folder
// on the user's Disk, as backup/<date>.json; the last fortnight is kept. From Settings a playlist
// of one comes back (as a new playlist "… (copy of <date>)") or Liked gets back what left it.
// Then (the user: "keep the likes, add the downloaded list, and the uploads by playlist as the
// songs themselves"): each device's downloaded tracks, as a list to download again, and the user's
// own uploaded mp3s as files, a folder a playlist (backup/uploads/<playlist>/<Artist - Title>.mp3),
// so a playlist whose uploads are gone from Yandex comes back with them. The Disk fetches the files
// itself (any device); a file stays while any kept copy names it.

import { api, storage, transport } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { offline } from '../player/player.ts';
import { visible } from '../share/mark.ts';
import { isUpload, tracksOf } from '../share/owner.ts';
import { fileName } from '../share/shared.ts';
import { disk, thisDevice } from '../sync/index.ts';

export const FOLDER = 'backup';
const UPLOADS = `${FOLDER}/uploads`;
const KEEP = 14;
const DONE = 'backup.day';

export interface BackupItem {
  id: string;
  albumId?: number;
}

/** An uploaded mp3 kept as a file: where (the first file is the one restored from; a track in two
 * playlists has a file in each one's folder). */
export interface BackupUpload {
  title: string;
  artists: string[];
  files: string[];
}

export interface Backup {
  v: 1;
  at: number;
  likes: string[];
  playlists: { kind: number | string; title: string; description?: string; tracks: BackupItem[] }[];
  /** Downloaded tracks, by device id: each device writes its own list (not in the first copies). */
  downloads?: Record<string, { platform: string; tracks: BackupItem[] }>;
  /** Own uploads kept as files, by track id (not in the first copies). */
  uploads?: Record<string, BackupUpload>;
}

/** "2026-10-26": a file a day. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const itemOf = (key: string): BackupItem => {
  const [id, album] = key.split(':');
  return album ? { id, albumId: Number(album) } : { id };
};

const itemOfTrack = (t: Track): BackupItem => {
  const album = t.albums?.[0]?.id;
  return album ? { id: String(t.id), albumId: Number(album) } : { id: String(t.id) };
};

/** A Track enough to add to a playlist or ask Yandex about. */
const asTrack = (x: BackupItem) => ({ id: x.id, albums: x.albumId ? [{ id: x.albumId }] : [] }) as unknown as Track;

const keyOf = (x: BackupItem) => (x.albumId ? `${x.id}:${x.albumId}` : x.id);

/** Uploading to Yandex again (a playlist's uploads gone from it) takes the file's bytes. */
const canUploadAgain = () => Boolean(transport.canUpload && transport.fetchBytes);

/** A playlist's folder name: no characters a folder cannot have. */
const folderName = (title: string) => title.replace(/[<>:"|?*\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Playlist';

/** The library as it is now; with the own uploads met in the playlists, each with its playlist. */
async function take(now: number) {
  const likes = await api.likedTrackKeys();
  const playlists: Backup['playlists'] = [];
  const uploads: { track: Track; playlist: string }[] = [];
  for (const pl of await api.playlists()) {
    const tracks = await tracksOf(pl);
    playlists.push({ kind: pl.kind, title: pl.title, description: visible(pl.description) || undefined, tracks: tracks.map(itemOfTrack) });
    for (const t of tracks) if (isUpload(t)) uploads.push({ track: t, playlist: pl.title });
  }
  const downloads = offline ? { [thisDevice.id]: { platform: thisDevice.platform, tracks: offline.entries().map((e) => itemOfTrack(e.track)) } } : {};
  const backup: Backup = { v: 1, at: now, likes, playlists, downloads };
  return { backup, uploads };
}

/** The library as it is now (the files of the uploads not sent). */
export async function snapshot(now = Date.now()): Promise<Backup> {
  return (await take(now)).backup;
}

/** Puts the uploads' files in place for a copy: a file already there stays, one kept in another
 * folder before is copied by Disk itself, a new one is sent. A track that fails is left out
 * (tried the next day). */
export async function keepUploads(met: { track: Track; playlist: string }[], before: Backup['uploads'] = {}, root = UPLOADS): Promise<Record<string, BackupUpload>> {
  const out: Record<string, BackupUpload> = {};
  const there = new Map<string, Set<string>>();
  const inFolder = async (folder: string) => {
    let names = there.get(folder);
    if (!names) {
      names = new Set((await disk.folder(folder)).map((f) => f.name));
      there.set(folder, names);
    }
    return names;
  };
  const exists = async (path: string) => {
    const i = path.lastIndexOf('/');
    return (await inFolder(path.slice(0, i))).has(path.slice(i + 1));
  };
  if (met.length) await disk.mkdir(FOLDER).then(() => disk.mkdir(root));
  const taken = new Map<string, string>();
  for (const { track: t, playlist } of met) {
    const id = String(t.id);
    const folder = `${root}/${folderName(playlist)}`;
    let path = `${folder}/${fileName(t)}`;
    // two uploads of one name in one playlist: the second one's file gets its id
    if (taken.has(path) && taken.get(path) !== id) path = path.replace(/\.mp3$/, ` (${id}).mp3`);
    if (out[id]?.files.includes(path)) continue;
    try {
      if (!(await exists(path))) {
        await disk.mkdir(folder);
        const from = [...(out[id]?.files ?? []), ...(before[id]?.files ?? [])];
        let copied = false;
        for (const f of from) {
          if (!(await exists(f))) continue;
          await disk.copy(f, path);
          copied = true;
          break;
        }
        if (!copied) await disk.uploadFrom(path, (await api.stream(id)).url);
        (await inFolder(folder)).add(path.slice(folder.length + 1));
      }
      taken.set(path, id);
      out[id] ??= { title: t.title, artists: (t.artists ?? []).map((a) => a.name), files: [] };
      out[id].files.push(path);
    } catch (e) {
      console.warn('backup: an upload not kept', id, e);
    }
  }
  return out;
}

/** The files no kept copy names leave the uploads' folders (and a folder left empty goes). */
async function sweepUploads(copies: Backup[], root = UPLOADS) {
  const named = new Set(copies.flatMap((c) => Object.values(c.uploads ?? {}).flatMap((u) => u.files)));
  for (const dir of await disk.folders(root)) {
    const folder = `${root}/${dir}`;
    const files = await disk.folder(folder);
    const gone = files.filter((f) => !named.has(`${folder}/${f.name}`));
    for (const f of gone) await disk.remove(`${folder}/${f.name}`);
    if (gone.length === files.length) await disk.remove(folder);
  }
}

/** Once a day (a device that made today's copy does not make it again); the oldest beyond a
 * fortnight go. Another device's part of today's copy (its downloads; the desktop's files) stays.
 * Quietly: a backup that fails is tried the next day. */
export async function backUp(now = Date.now()) {
  const day = dayOf(now);
  if (storage.getItem(DONE) === day) return false;
  await disk.mkdir(FOLDER);
  const { backup, uploads } = await take(now);
  const days = await list();
  const today = days.includes(day) ? await read(day).catch(() => null) : null;
  const last = today ?? (days.length ? await read(days[0]).catch(() => null) : null);
  backup.downloads = { ...today?.downloads, ...backup.downloads };
  backup.uploads = await keepUploads(uploads, last?.uploads);
  await disk.write(`${FOLDER}/${day}.json`, JSON.stringify(backup));
  storage.setItem(DONE, day);
  const old = days.filter((d) => d !== day).slice(KEEP - 1);
  for (const d of old) await disk.remove(`${FOLDER}/${d}.json`);
  const kept = [backup, ...(await Promise.all(days.filter((d) => d !== day && !old.includes(d)).map((d) => read(d).catch(() => null))))];
  // a copy that would not read: its files are not known, so nothing is swept this time
  if (kept.every(Boolean)) await sweepUploads(kept as Backup[]);
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

/** A playlist of a copy, as a new playlist (the one there now is left as it is). Own uploads Yandex
 * no longer has are uploaded again from their files (they join at the end, as Yandex takes them
 * in); `lost`: the uploads that could not come back. */
export async function restorePlaylist(b: Backup, kind: number | string, title: string): Promise<Playlist & { lost?: number }> {
  const pl = b.playlists.find((p) => String(p.kind) === String(kind));
  if (!pl) throw new Error('no such playlist in the copy');
  const own = pl.tracks.filter((x) => b.uploads?.[x.id]);
  const alive = new Set(own.length ? (await api.tracks(own.map((x) => x.id))).filter((t) => t.available !== false).map((t) => String(t.id)) : []);
  const gone = own.filter((x) => !alive.has(x.id));
  let made = await api.createPlaylist(title);
  if (pl.description) made = await api.setPlaylistDescription(made.kind, pl.description);
  const tracks = pl.tracks.filter((x) => !gone.includes(x)).map(asTrack);
  for (let i = 0; i < tracks.length; i += 100) made = await api.addToPlaylist(made, tracks.slice(i, i + 100), made.trackCount ?? i);
  let lost = 0;
  for (const x of gone) {
    const file = b.uploads![x.id].files[0];
    try {
      if (!canUploadAgain()) throw new Error('no uploads here');
      await api.upload({ name: file.slice(file.lastIndexOf('/') + 1), data: await disk.readBytes(file) }, made);
    } catch (e) {
      console.warn('backup: an upload not brought back', x.id, e);
      lost++;
    }
  }
  return lost ? { ...made, lost } : made;
}

/** What a copy's Liked had and Liked has not now: liked again. How many. */
export async function restoreLikes(b: Backup): Promise<number> {
  const now = new Set((await api.likedTrackKeys()).map((k) => k.split(':')[0]));
  const back = b.likes.filter((k) => !now.has(itemOf(k).id));
  for (let i = 0; i < back.length; i += 100) await api.setLiked(back.slice(i, i + 100), true);
  return back.length;
}

/** A device's downloads of a copy that are not downloaded here, as tracks Yandex still gives. */
export async function toDownload(items: BackupItem[]): Promise<Track[]> {
  const missing = items.filter((x) => !offline?.has(x.id));
  if (!missing.length) return [];
  return (await api.tracks(missing.map(keyOf))).filter((t) => t.available !== false);
}
