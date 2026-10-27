// Shared uploads, the owner's side (shared.ts says what for): every playlist of the user's with his
// own uploads in it goes into the "shared" folder of Oni's folder on his Yandex Disk — a file per
// track (one for a track in two playlists) and index.json — the folder is opened by a link, and
// the link goes, hidden, into the description of each of his playlists (mark.ts), so a friend he
// sends any of them finds it. What left the playlists leaves the folder, unless a kept backup copy
// names it: the backup keeps its uploads here too, a track once (backup.ts). Any device does it: the
// Disk fetches each file itself from the upload's stream (the user, 26.10.2026: "why only the PC?").

import { create } from 'zustand';
import { api, storage } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { disk, useSync } from '../sync/index.ts';
import { readMark, withMark } from './mark.ts';
import { INDEX, SHARED, type SharedIndex, type SharedPlaylist } from './shared.ts';

const ON = 'share.uploads';
const LINK = 'share.link';

export interface ShareState {
  on: boolean;
  busy: boolean;
  /** Files sent this round, of how many. */
  done: number;
  total: number;
  /** The last round: when it ended, and how many tracks of how many playlists are shared. */
  at: number | null;
  tracks: number;
  playlists: number;
  error: string | null;
}

// On unless switched off: a friend opening one's playlist finds the uploads with nothing to set up
// first (the user, 26.10.2026: "the main new thing"; switched off by hand, it stays off).
export const useShare = create<ShareState>(() => ({ on: storage.getItem(ON) !== '0', busy: false, done: 0, total: 0, at: null, tracks: 0, playlists: 0, error: null }));

export function setSharing(on: boolean) {
  storage.setItem(ON, on ? '1' : '0');
  useShare.setState({ on });
  void (on ? shareUploads() : unshare());
}

/** A playlist's tracks, whole (a big one comes as ids: the rest asked for). */
export async function tracksOf(pl: Playlist): Promise<Track[]> {
  const full = await api.playlist(pl.uid, pl.kind);
  const items = full.tracks ?? [];
  const missing = items.filter((i) => !i.track).map((i) => String(i.id));
  const fetched = missing.length ? await api.tracks(missing) : [];
  const byId = new Map(fetched.map((t) => [String(t.id), t]));
  return items.map((i) => i.track ?? byId.get(String(i.id))).filter((t): t is Track => Boolean(t));
}

export const isUpload = (t: Track) => t.trackSource === 'UGC';
export const fileOf = (t: Track) => `${t.id}.mp3`;

/** An upload put on the Disk as `path`, the Disk fetching it from Yandex itself. */
export const sendUpload = (path: string, id: string) => disk.uploadFresh(path, async () => (await api.stream(id)).url);

let running: Promise<void> | null = null;

/** Brings the shared folder up to date with the playlists (one round at a time). */
export function shareUploads(): Promise<void> {
  if (!useShare.getState().on || !useSync.getState().connected) return Promise.resolve();
  running ??= round().then(() => {}).finally(() => (running = null));
  return running;
}

/** A round's reach (the e2e run: a folder of its own, one playlist, a few tracks, no marks — the
 * account and its real shared folder are left as they are). */
export interface RoundOptions {
  folder?: string;
  only?: (number | string)[];
  maxTracks?: number;
  mark?: boolean;
}

/** One round; the link of the folder (null when it failed: `useShare` says why). */
export async function round(opts: RoundOptions = {}): Promise<string | null> {
  const folder = opts.folder ?? SHARED;
  useShare.setState({ busy: true, done: 0, total: 0, error: null });
  try {
    const account = await api.account();
    const mine = (await api.playlists()).filter((p) => !opts.only || opts.only.map(String).includes(String(p.kind)));
    const shared: SharedPlaylist[] = [];
    const wanted = new Map<string, Track>();
    for (const pl of mine) {
      const uploads = (await tracksOf(pl)).filter(isUpload).slice(0, opts.maxTracks ?? Infinity);
      if (!uploads.length) continue;
      shared.push({
        kind: pl.kind,
        title: pl.title,
        tracks: uploads.map((t) => ({ id: String(t.id), file: fileOf(t), title: t.title, artists: (t.artists ?? []).map((a) => a.name), durationMs: t.durationMs })),
      });
      for (const t of uploads) wanted.set(fileOf(t), t);
    }
    await disk.mkdir(folder);
    const there = new Set((await disk.folder(folder)).map((f) => f.name));
    const send = [...wanted].filter(([file]) => !there.has(file));
    // what left every playlist leaves the folder first, so a round cut short (no answer) frees the room too
    const left = [...there].filter((name) => name !== INDEX && !wanted.has(name));
    const kept = left.length ? await import('../backup/backup.ts').then((m) => m.keptUploads()).catch(() => null) : null;
    for (const name of left) {
      if (!kept || kept.has(name.replace(/\.mp3$/, ''))) continue;
      await disk.remove(`${folder}/${name}`);
      there.delete(name);
    }
    useShare.setState({ total: send.length });
    // The index lists what is in the folder already, so a friend sees the first tracks at once and
    // the rest as they come (the user, 27.10.2026: "why not as soon as the first track is there?");
    // `pending`: how many are still on their way (the friend's page looks again while there are).
    const owner = { uid: account.uid, name: account.displayName || account.login || '' };
    const present = new Set([...there].filter((name) => wanted.has(name)));
    const writeIndex = (pending: number) => {
      const playlists = shared.map((p) => ({ ...p, tracks: p.tracks.filter((x) => present.has(x.file)) })).filter((p) => p.tracks.length);
      const index: SharedIndex = { v: 1, owner, updated: Date.now(), playlists, ...(pending ? { pending } : {}) };
      return disk.write(`${folder}/${INDEX}`, JSON.stringify(index));
    };
    await writeIndex(send.length);
    // the folder opened and marked first: the button shows to a friend while the files go up
    const link = await disk.publish(folder);
    if (opts.mark !== false) {
      storage.setItem(LINK, link);
      // the hidden mark in each of the user's playlists (those that have it already are left alone)
      for (const pl of mine) {
        if (readMark(pl.description) === link) continue;
        await api.setPlaylistDescription(pl.kind, withMark(pl.description, link));
      }
    }
    let written = Date.now();
    for (const [i, [file, t]] of send.entries()) {
      await sendUpload(`${folder}/${file}`, String(t.id));
      present.add(file);
      useShare.setState((s) => ({ done: s.done + 1 }));
      // the index again after the first track, then every few or every 10 s
      const left = send.length - i - 1;
      if (left && (i === 0 || (i + 1) % 5 === 0 || Date.now() - written > 10_000)) {
        await writeIndex(left);
        written = Date.now();
      }
    }
    await writeIndex(0);
    useShare.setState({ at: Date.now(), tracks: wanted.size, playlists: shared.length });
    return link;
  } catch (e) {
    useShare.setState({ error: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    useShare.setState({ busy: false });
  }
}

/** Sharing off: the marks leave the playlists and the folder is closed; its tracks stay for the
 * backup, which takes away those it does not need. */
async function unshare() {
  try {
    for (const pl of await api.playlists()) if (readMark(pl.description)) await api.setPlaylistDescription(pl.kind, withMark(pl.description, null));
    await disk.unpublish(SHARED);
    await disk.remove(`${SHARED}/${INDEX}`);
    storage.setItem(LINK, '');
    useShare.setState({ at: null, tracks: 0, playlists: 0, error: null });
  } catch (e) {
    useShare.setState({ error: e instanceof Error ? e.message : String(e) });
  }
}
