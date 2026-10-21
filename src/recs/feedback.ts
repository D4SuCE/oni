// What the user told the mixes without a dislike (which would go to Yandex for the whole
// account): tracks hidden from the mixes, and artists demoted after two skips in a row.
// Applied to every mix when it is shown, so it works at once, without a rebuild.

import type { Track } from '../api/types.ts';
import type { KeyValueStore } from '../wave/history.ts';
import { DAY } from './util.ts';

export type PlayOutcome = 'skipped' | 'finished' | 'partial';

interface ArtistState {
  name: string;
  /** Skips in a row of this artist's tracks. */
  streak: number;
  demotedUntil?: number;
}

interface Saved {
  hidden: string[];
  artists: Record<string, ArtistState>;
}

const KEY = 'recs.feedback.v1';
/** Two skips in a row demote an artist… */
export const DEMOTE_AFTER = 2;
/** …for this long. */
export const DEMOTE_FOR = 30 * DAY;

export class RecsFeedback {
  private hidden: Set<string>;
  private artists: Record<string, ArtistState>;
  private store: KeyValueStore;
  private listeners = new Set<() => void>();

  constructor(store: KeyValueStore) {
    this.store = store;
    let saved: Partial<Saved> = {};
    try {
      saved = JSON.parse(store.getItem(KEY) || '{}');
    } catch {
      /* start over */
    }
    this.hidden = new Set(saved.hidden ?? []);
    this.artists = saved.artists ?? {};
  }

  /** `changed`: what the mixes keep is different now, so listeners are told. */
  private save(changed: boolean) {
    this.store.setItem(KEY, JSON.stringify({ hidden: [...this.hidden], artists: this.artists } satisfies Saved));
    if (changed) for (const fn of this.listeners) fn();
  }

  /** Called when a track is hidden, an artist demoted, or everything brought back; returns the unsubscribe function. */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  hide(trackId: string | number) {
    this.hidden.add(String(trackId));
    this.save(true);
  }

  isHidden(trackId: string | number) {
    return this.hidden.has(String(trackId));
  }

  /**
   * A play ended. A skip adds to the streak of each of the track's artists, and the second in a
   * row demotes them; any other ending clears the streak (and lifts nothing early).
   * Returns the artists demoted by this play.
   */
  recordPlay(track: Track, outcome: PlayOutcome, now: number): string[] {
    const demoted: string[] = [];
    for (const a of track.artists || []) {
      if (a.various) continue;
      const id = String(a.id);
      const cur = this.artists[id] ?? { name: a.name, streak: 0 };
      cur.name = a.name;
      if (outcome === 'skipped') {
        cur.streak++;
        if (cur.streak >= DEMOTE_AFTER && !this.isDemoted(id, now)) {
          cur.demotedUntil = now + DEMOTE_FOR;
          demoted.push(a.name);
        }
      } else cur.streak = 0;
      this.artists[id] = cur;
    }
    // Forget artists with nothing to remember, so the record stays small.
    for (const [id, s] of Object.entries(this.artists)) if (!s.streak && !(s.demotedUntil && s.demotedUntil > now)) delete this.artists[id];
    this.save(demoted.length > 0);
    return demoted;
  }

  isDemoted(artistId: string | number, now: number) {
    const until = this.artists[String(artistId)]?.demotedUntil;
    return Boolean(until && until > now);
  }

  demotedArtists(now: number): string[] {
    return Object.entries(this.artists)
      .filter(([id]) => this.isDemoted(id, now))
      .map(([, s]) => s.name);
  }

  hiddenCount() {
    return this.hidden.size;
  }

  /** Whether a track may appear in a mix: not hidden, and none of its artists demoted. */
  keeps(track: Track, now: number) {
    return !this.hidden.has(String(track.id)) && !(track.artists || []).some((a) => !a.various && this.isDemoted(a.id, now));
  }

  /** Brings back every hidden track and demoted artist. */
  reset() {
    this.hidden.clear();
    this.artists = {};
    this.save(true);
  }
}

/** Outcome of a play the way the stats count it: skipped within 30 s, finished at the end or 85%. */
export function playOutcome(listened: number, duration: number, ended: boolean): PlayOutcome {
  if (ended || (duration > 0 && listened >= duration * 0.85)) return 'finished';
  return listened < 30 ? 'skipped' : 'partial';
}
