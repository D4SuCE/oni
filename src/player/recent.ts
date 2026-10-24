// What was played in this app, in order, with times: the "Oni" tab of History (once "In this app").
// Yandex's own history only shows plays from its official clients and radio sessions.

import type { Track } from '../api/types.ts';
import type { KeyValueStore } from '../wave/history.ts';
import type { ListLabel } from './player.ts';

export interface RecentPlay {
  track: Track;
  /** ms epoch when the track started */
  at: number;
  /** What the queue was ("Моя волна", a playlist title, …). */
  source: string;
  /** What it was, for its name in the interface language (player.ts, ListLabel). */
  label?: ListLabel;
  /** For playing it again from the same place. */
  from?: { playlist?: string; album?: number | string };
  /** Played on another device (src/sync): its name, as History shows it. */
  device?: string;
}

const KEY = 'player.recent.v1';
const LIMIT = 500;

/** Keeps what the track list needs and drops the heavy rest (lyrics, rights, …). */
export function trimTrack(t: Track): Track {
  return {
    id: t.id,
    title: t.title,
    version: t.version,
    durationMs: t.durationMs,
    artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name, various: a.various })),
    albums: (t.albums || []).slice(0, 1).map((a) => ({ id: a.id, title: a.title, genre: a.genre, coverUri: a.coverUri, artists: [] })),
    coverUri: t.coverUri,
    ogImage: t.ogImage,
    available: t.available,
    contentWarning: t.contentWarning,
    trackSource: t.trackSource,
    r128: t.r128,
    lyricsInfo: t.lyricsInfo,
    backgroundVideoUri: t.backgroundVideoUri,
  };
}

export class RecentPlays {
  private items: RecentPlay[];
  private remote: RecentPlay[] = [];
  private store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
    try {
      this.items = JSON.parse(store.getItem(KEY) || '[]');
    } catch {
      this.items = [];
    }
  }

  /** Newest first, the other devices' plays among them. */
  list(): RecentPlay[] {
    if (!this.remote.length) return this.items;
    return [...this.items, ...this.remote].sort((a, b) => b.at - a.at).slice(0, LIMIT * 2);
  }

  /** This device's plays, for Yandex Disk. */
  own(): RecentPlay[] {
    return this.items;
  }

  /** The other devices' plays (src/sync), each with its device's name. */
  setRemote(plays: RecentPlay[]) {
    this.remote = plays;
  }

  add(play: RecentPlay) {
    this.items = [{ ...play, track: trimTrack(play.track) }, ...this.items].slice(0, LIMIT);
    try {
      this.store.setItem(KEY, JSON.stringify(this.items));
    } catch {
      /* storage full: history is best effort */
    }
  }

  clear() {
    this.items = [];
    this.store.setItem(KEY, '[]');
  }
}
