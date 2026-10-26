// Shared uploads, the owner's side (shared.ts says what for): every playlist of the user's with his
// own uploads in it goes into the "shared" folder of Oni's folder on his Yandex Disk — a file per
// track (one for a track in two playlists) and index.json — the folder is opened by a link, and
// the link goes, hidden, into the description of each of his playlists (mark.ts), so a friend he
// sends any of them finds it. What left the playlists leaves the folder. The desktop does it (the
// uploads are made there, and only its shell sends a file's bytes to the Disk).

import { create } from 'zustand';
import { api, storage, transport } from '../api/client.ts';
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

export const useShare = create<ShareState>(() => ({ on: storage.getItem(ON) === '1', busy: false, done: 0, total: 0, at: null, tracks: 0, playlists: 0, error: null }));

/** The desktop with a Disk: it can share (the iPhone's shell sends no file's bytes up). */
export const canShare = () => transport.platform === 'electron';

export function setSharing(on: boolean) {
  storage.setItem(ON, on ? '1' : '0');
  useShare.setState({ on });
  void (on ? shareUploads() : unshare());
}

/** A playlist's tracks, whole (a big one comes as ids: the rest asked for). */
async function tracksOf(pl: Playlist): Promise<Track[]> {
  const full = await api.playlist(pl.uid, pl.kind);
  const items = full.tracks ?? [];
  const missing = items.filter((i) => !i.track).map((i) => String(i.id));
  const fetched = missing.length ? await api.tracks(missing) : [];
  const byId = new Map(fetched.map((t) => [String(t.id), t]));
  return items.map((i) => i.track ?? byId.get(String(i.id))).filter((t): t is Track => Boolean(t));
}

const isUpload = (t: Track) => t.trackSource === 'UGC';
const fileOf = (t: Track) => `${t.id}.mp3`;

let running: Promise<void> | null = null;

/** Brings the shared folder up to date with the playlists (one round at a time). */
export function shareUploads(): Promise<void> {
  if (!useShare.getState().on || !canShare() || !useSync.getState().connected) return Promise.resolve();
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
    useShare.setState({ total: send.length });
    for (const [file, t] of send) {
      const stream = await api.stream(String(t.id));
      const bytes = await transport.fetchBytes!(stream.url);
      await disk.writeBytes(`${folder}/${file}`, bytes);
      useShare.setState((s) => ({ done: s.done + 1 }));
    }
    // what left every playlist leaves the folder
    for (const name of there) if (name !== INDEX && !wanted.has(name)) await disk.remove(`${folder}/${name}`);
    const index: SharedIndex = { v: 1, owner: { uid: account.uid, name: account.displayName || account.login || '' }, updated: Date.now(), playlists: shared };
    await disk.write(`${folder}/${INDEX}`, JSON.stringify(index));
    const link = await disk.publish(folder);
    if (opts.mark !== false) {
      storage.setItem(LINK, link);
      // the hidden mark in each of the user's playlists (those that have it already are left alone)
      for (const pl of mine) {
        if (readMark(pl.description) === link) continue;
        await api.setPlaylistDescription(pl.kind, withMark(pl.description, link));
      }
    }
    useShare.setState({ at: Date.now(), tracks: wanted.size, playlists: shared.length });
    return link;
  } catch (e) {
    useShare.setState({ error: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    useShare.setState({ busy: false });
  }
}

/** Sharing off: the marks leave the playlists and the folder is closed and removed. */
async function unshare() {
  try {
    for (const pl of await api.playlists()) if (readMark(pl.description)) await api.setPlaylistDescription(pl.kind, withMark(pl.description, null));
    await disk.remove(SHARED);
    storage.setItem(LINK, '');
    useShare.setState({ at: null, tracks: 0, playlists: 0, error: null });
  } catch (e) {
    useShare.setState({ error: e instanceof Error ? e.message : String(e) });
  }
}
