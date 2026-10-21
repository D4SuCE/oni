// Local memory of what the user actually listened to. Yandex's wave keeps
// re-serving the same tracks; this is what lets us notice and drop them.

import type { Track } from '../api/types.ts';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HistoryEntry {
  /** Times heard (≥ HEARD_SECONDS or to the end). */
  plays: number;
  /** Times skipped early. */
  skips: number;
  /** Last time the track was heard or skipped, ms epoch. */
  last: number;
}

export const HEARD_SECONDS = 30;
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 365;

export class ListenHistory {
  private entries: Record<string, HistoryEntry> = {};
  private store: KeyValueStore;
  private key: string;
  private now: () => number;

  constructor(store: KeyValueStore, key = 'wave.history.v1', now = () => Date.now()) {
    this.store = store;
    this.key = key;
    this.now = now;
    try {
      this.entries = JSON.parse(store.getItem(key) || '{}');
    } catch {
      this.entries = {};
    }
    this.prune();
  }

  get(trackId: string): HistoryEntry | undefined {
    return this.entries[trackId];
  }

  get size() {
    return Object.keys(this.entries).length;
  }

  /** Call when playback of a track ends for any reason. */
  record(track: Track, playedSeconds: number, finished: boolean) {
    const id = String(track.id);
    const e = (this.entries[id] ??= { plays: 0, skips: 0, last: 0 });
    if (finished || playedSeconds >= HEARD_SECONDS) e.plays++;
    else e.skips++;
    e.last = this.now();
    this.save();
  }

  /**
   * Plays from the account's other devices (Yandex's own history), so the repeat filter is the
   * account's. Each only moves "last heard" forward: merging the same history again, or one that
   * holds this device's plays too, counts nothing twice; a track new here counts as heard once.
   */
  mergeRemote(plays: { id: string; at: number }[]) {
    let changed = false;
    for (const { id, at } of plays) {
      const e = this.entries[id];
      if (!e) {
        this.entries[id] = { plays: 1, skips: 0, last: at };
        changed = true;
      } else if (at > e.last) {
        e.last = at;
        e.plays = Math.max(e.plays, 1);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  daysSince(trackId: string): number {
    const e = this.entries[trackId];
    return e ? (this.now() - e.last) / DAY : Infinity;
  }

  clear() {
    this.entries = {};
    this.save();
  }

  private prune() {
    const cutoff = this.now() - KEEP_DAYS * DAY;
    for (const [id, e] of Object.entries(this.entries)) if (e.last < cutoff) delete this.entries[id];
  }

  private save() {
    try {
      this.store.setItem(this.key, JSON.stringify(this.entries));
    } catch {
      /* storage full or unavailable — history is best effort */
    }
  }
}
