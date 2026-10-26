// Playlist import, step three: every track of the list looked for in Yandex's catalogue, the
// playlist made in the account (in the list's order), and the tracks not found kept to look for
// again: once a day Oni asks for them, and adds those that turned up to their playlist (the user,
// 26.10.2026: "not found — your own mp3, or wait till Yandex has it"). The waiting list is this
// device's (kept in its storage); half a year on, a track is given up.

import { api, storage } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { pick, queryOf, type Match } from './match.ts';
import type { SourceList, SourceTrack } from './sources.ts';

export interface Row {
  src: SourceTrack;
  match: Match;
  /** What goes into the playlist: the best candidate when found, the user's pick, or none. */
  chosen: Track | null;
}

/** At once; Yandex's search answers four at a time without complaint. */
const PARALLEL = 4;

/** One track: "artist title", and the title alone when that found no sure match. */
export async function findOne(src: SourceTrack, videos: boolean): Promise<Match> {
  const search = async (q: string) => (q ? ((await api.search(q, 'track')).tracks?.results ?? []) : []);
  const first = await search(queryOf(src));
  let m = pick(src, first, videos);
  if (m.state !== 'found' && src.artists.length) {
    const more = pick(src, [...first, ...(await search(src.title))], videos);
    if ((more.candidates[0]?.score ?? 0) > (m.candidates[0]?.score ?? 0)) m = more;
  }
  return m;
}

/** All of the list, `onRow` as each is known (in any order; the index says where it goes). */
export async function findAll(list: SourceList, onRow: (i: number, row: Row) => void, cancelled: () => boolean = () => false) {
  const videos = list.from === 'youtube';
  let next = 0;
  const worker = async () => {
    while (next < list.tracks.length && !cancelled()) {
      const i = next++;
      const src = list.tracks[i];
      let match: Match;
      try {
        match = await findOne(src, videos);
      } catch {
        // one search failing (the network blinked): asked once more, then it stays unfound
        match = await findOne(src, videos).catch(() => ({ state: 'none' as const, candidates: [] }));
      }
      onRow(i, { src, match, chosen: match.state === 'found' ? match.candidates[0].track : null });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

/** Yandex takes a hundred tracks a change without trouble. */
const BATCH = 100;

/** The playlist, made with the chosen tracks in the list's order; the rest wait (see above). */
export async function createFrom(title: string, rows: Row[], videos = false): Promise<Playlist> {
  let pl = await api.createPlaylist(title);
  const tracks = rows.map((r) => r.chosen).filter((t): t is Track => Boolean(t));
  for (let i = 0; i < tracks.length; i += BATCH) pl = await api.addToPlaylist(pl, tracks.slice(i, i + BATCH), pl.trackCount ?? i);
  const missing = rows.filter((r) => !r.chosen).map((r) => r.src);
  if (missing.length) wait(pl, missing, videos);
  return pl;
}

// ------------------------------------------------------------ the waiting list

const WAITING = 'import.waiting';
const CHECKED = 'import.checkedAt';
const DAY = 24 * 60 * 60 * 1000;
const GIVE_UP = 182 * DAY;

export interface Waiting {
  playlist: { uid: number | string; kind: number | string; title: string };
  src: SourceTrack;
  videos?: boolean;
  since: number;
}

export function waiting(): Waiting[] {
  try {
    return JSON.parse(storage.getItem(WAITING) || '[]');
  } catch {
    return [];
  }
}

function save(list: Waiting[]) {
  storage.setItem(WAITING, JSON.stringify(list));
}

function wait(pl: Playlist, tracks: SourceTrack[], videos = false) {
  const now = Date.now();
  save([...waiting(), ...tracks.map((src) => ({ playlist: { uid: pl.uid, kind: pl.kind, title: pl.title }, src, videos, since: now }))]);
}

/**
 * Once a day: the waiting tracks asked for again; those found now go to the end of their
 * playlist. Returns what was added, by playlist title (for a note), or null when not yet time.
 */
export async function checkWaiting(now = Date.now()): Promise<Map<string, number> | null> {
  const list = waiting().filter((w) => now - w.since < GIVE_UP);
  if (!list.length) return save(list), null;
  if (now - Number(storage.getItem(CHECKED) || 0) < DAY) return null;
  storage.setItem(CHECKED, String(now));
  const added = new Map<string, number>();
  const left: Waiting[] = [];
  const found = new Map<string, { w: Waiting; track: Track }[]>();
  for (const w of list) {
    const m = await findOne(w.src, Boolean(w.videos)).catch(() => null);
    if (m?.state === 'found') {
      const key = `${w.playlist.uid}:${w.playlist.kind}`;
      found.set(key, [...(found.get(key) ?? []), { w, track: m.candidates[0].track }]);
    } else left.push(w);
  }
  for (const items of found.values()) {
    const { uid, kind, title } = items[0].w.playlist;
    try {
      const pl = await api.playlist(uid, kind);
      await api.addToPlaylist(pl, items.map((x) => x.track), pl.trackCount);
      added.set(pl.title || title, items.length);
    } catch {
      // the network failed, or the playlist is gone: asked again tomorrow (a deleted playlist's
      // tracks are given up with the rest, half a year on)
      left.push(...items.map((x) => x.w));
    }
  }
  save(left);
  return added;
}
