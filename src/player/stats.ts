// How plays end, by where they came from: the data behind "How recommendations do"
// in Settings. A play counts as finished at the end of the track or after 85% of it,
// and as skipped when it was left within the first 30 seconds.

import type { KeyValueStore } from '../wave/history.ts';

export type Origin = 'wave' | 'radio' | 'daylist' | 'mix' | 'discover' | 'radar' | 'repeat' | 'rewind' | 'because' | 'smart' | 'auto' | 'own' | 'list';

export interface PlayOutcome {
  at: number;
  origin: Origin;
  finished: boolean;
  skipped: boolean;
}

export interface OriginSummary {
  origin: Origin;
  plays: number;
  /** Share 0…1 of plays listened to the end (or 85%). */
  finished: number;
  /** Share 0…1 of plays left within 30 seconds. */
  skipped: number;
}

const KEY = 'player.stats.v1';
const LIMIT = 3000;
const DAY = 86_400_000;

export class PlayStats {
  private items: PlayOutcome[];
  private store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
    try {
      this.items = JSON.parse(store.getItem(KEY) || '[]');
    } catch {
      this.items = [];
    }
  }

  record(origin: Origin, listenedSeconds: number, durationSeconds: number, ended: boolean, now = Date.now()) {
    const finished = ended || (durationSeconds > 0 && listenedSeconds >= 0.85 * durationSeconds);
    this.items = [...this.items, { at: now, origin, finished, skipped: !finished && listenedSeconds < 30 }].slice(-LIMIT);
    try {
      this.store.setItem(KEY, JSON.stringify(this.items));
    } catch {
      /* storage full: stats are best effort */
    }
  }

  /** Per origin over the last `days`, most played first. */
  summary(days = 30, now = Date.now()): OriginSummary[] {
    const by = new Map<Origin, PlayOutcome[]>();
    for (const p of this.items) if (now - p.at <= days * DAY) by.set(p.origin, [...(by.get(p.origin) ?? []), p]);
    return [...by.entries()]
      .map(([origin, ps]) => ({
        origin,
        plays: ps.length,
        finished: ps.filter((p) => p.finished).length / ps.length,
        skipped: ps.filter((p) => p.skipped).length / ps.length,
      }))
      .sort((a, b) => b.plays - a.plays);
  }
}
