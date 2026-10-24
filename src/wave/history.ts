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

/** A version that only says how a song was released, not another take of it (a remix, a live one). */
const RELEASE = /remaster|mono|stereo|radio edit|single version|album version|original version|explicit|clean|deluxe|bonus|anniversary|edition/i;

/**
 * The song a track is, whichever release it comes from: an album's, a single's and a compilation's
 * have their own ids, and Yandex's wave offers them as different tracks (the user: with "Only new"
 * on, songs heard three times came again). One key per artist, so a featured artist listed or not
 * still matches. None for a remix or a live take: that is a song of its own.
 */
export function songKeys(t: Track): string[] {
  if (t.version && !RELEASE.test(t.version)) return [];
  const title = t.title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([][^)\]]*(feat\.?|ft\.|with |remaster)[^)\]]*[)\]]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!title) return [];
  return (t.artists || []).filter((a) => a.id && !a.various).map((a) => `song:${a.id}:${title}`);
}
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 365;

export class ListenHistory {
  private entries: Record<string, HistoryEntry> = {};
  /** The account's other devices (src/sync, Yandex Disk): read, never saved here nor sent back. */
  private remote: Record<string, HistoryEntry>[] = [];
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
    const own = this.entries[trackId];
    if (!this.remote.length) return own;
    // Each field at its highest: the same play can be in two devices' entries (Yandex's history
    // brings it to both), so counts are not added up.
    let found = own;
    for (const r of this.remote) {
      const e = r[trackId];
      if (!e) continue;
      found = found ? { plays: Math.max(found.plays, e.plays), skips: Math.max(found.skips, e.skips), last: Math.max(found.last, e.last) } : e;
    }
    return found;
  }

  /** The track, or the same song under another id (songKeys): its most heard and latest entry. */
  of(track: Track): HistoryEntry | undefined {
    let found = this.get(String(track.id));
    for (const key of songKeys(track)) {
      const e = this.get(key);
      if (e && (!found || e.plays > found.plays || (e.plays === found.plays && e.last > found.last))) found = e;
    }
    return found;
  }

  /** This device's entries, for its file on Yandex Disk. */
  own(): Record<string, HistoryEntry> {
    return this.entries;
  }

  /** The other devices' entries (src/sync): replaced as a whole on every read of the Disk. */
  setRemote(devices: Record<string, HistoryEntry>[]) {
    this.remote = devices;
  }

  /** Tracks remembered (the songs' entries are a second look at the same plays). */
  get size() {
    return Object.keys(this.entries).filter((k) => !k.startsWith('song:')).length;
  }

  /** Call when playback of a track ends for any reason. */
  record(track: Track, playedSeconds: number, finished: boolean) {
    for (const key of [String(track.id), ...songKeys(track)]) {
      const e = (this.entries[key] ??= { plays: 0, skips: 0, last: 0 });
      if (finished || playedSeconds >= HEARD_SECONDS) e.plays++;
      else e.skips++;
      e.last = this.now();
    }
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

  /**
   * The songs of tracks heard before songs were kept (cards from the play log, which has their
   * titles): each song as heard as its most heard track. Run at every start: it changes nothing twice.
   */
  learnSongs(cards: Track[]) {
    let changed = false;
    for (const card of cards) {
      const e = this.entries[String(card.id)];
      if (!e) continue;
      for (const key of songKeys(card)) {
        const s = (this.entries[key] ??= { plays: 0, skips: 0, last: 0 });
        if (s.plays >= e.plays && s.skips >= e.skips && s.last >= e.last) continue;
        Object.assign(s, { plays: Math.max(s.plays, e.plays), skips: Math.max(s.skips, e.skips), last: Math.max(s.last, e.last) });
        changed = true;
      }
    }
    if (changed) this.save();
  }

  daysSince(track: string | Track): number {
    const e = typeof track === 'string' ? this.get(track) : this.of(track);
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
