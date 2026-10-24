// The play log behind "Recap" (History → Recap): every play heard (30 s or to the end) with its
// date and how long it played, plus a short card of each track. The listen history (wave/history.ts)
// keeps only counts and the last time per track, Yandex's own only about ten days: this one keeps
// about thirteen months, so a month and a year can be summed up. Other devices' plays come from
// Yandex's days (mergeRemote); the first start fills it from the recent plays (seed).

import type { Artist, Track } from '../api/types.ts';
import type { KeyValueStore } from '../wave/history.ts';

export interface LoggedPlay {
  id: string;
  /** ms epoch when it started */
  at: number;
  /** Seconds it played. */
  s: number;
  /** Played on another device (from Yandex's history). */
  r?: 1;
}

export interface Recap {
  plays: number;
  minutes: number;
  /** Different tracks, artists, and days with music. */
  trackCount: number;
  artistCount: number;
  days: number;
  tracks: { track: Track; plays: number; seconds: number }[];
  /** `track`: the artist's most played one (its cover stands for the artist). */
  artists: { artist: Artist; plays: number; seconds: number; track: Track }[];
  genres: { genre: string; plays: number }[];
}

const KEY = 'player.playlog.v1';
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 400;

interface Stored {
  plays: LoggedPlay[];
  tracks: Record<string, Track>;
  seeded?: boolean;
}

/** The card a recap needs: titles, artists, the cover, the genre. */
function card(t: Track): Track {
  const album = t.albums?.[0];
  return {
    id: t.id,
    title: t.title,
    version: t.version,
    durationMs: t.durationMs,
    artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })),
    albums: album ? [{ id: album.id, title: album.title, genre: album.genre, coverUri: album.coverUri, artists: [] }] : [],
    coverUri: t.coverUri,
    available: t.available,
  };
}

const dayOf = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export class PlayLog {
  private data: Stored;
  private store: KeyValueStore;
  private now: () => number;

  constructor(store: KeyValueStore, now = () => Date.now()) {
    this.store = store;
    this.now = now;
    try {
      this.data = { plays: [], tracks: {}, ...JSON.parse(store.getItem(KEY) || '{}') };
    } catch {
      this.data = { plays: [], tracks: {} };
    }
    this.prune();
  }

  /** The card of every track in the log. */
  cards(): Track[] {
    return Object.values(this.data.tracks);
  }

  /** A play heard here: `seconds` it played. */
  record(track: Track, at: number, seconds: number) {
    this.add(track, { id: String(track.id), at, s: Math.round(seconds) });
    this.save();
  }

  /** The first time only: the recent plays there were before the log (their length unknown: the track's). */
  seed(recent: { track: Track; at: number }[]) {
    if (this.data.seeded) return;
    for (const { track, at } of recent) this.add(track, { id: String(track.id), at, s: Math.round((track.durationMs || 0) / 1000) });
    this.data.seeded = true;
    this.prune();
    this.save();
  }

  /**
   * Yandex's days (every device): a track not heard here that day was played elsewhere, once, for
   * its length. Merging the same days again adds nothing.
   */
  mergeRemote(days: { date: number; tracks: Track[] }[]) {
    const heard = new Set(this.data.plays.map((p) => `${p.id}@${dayOf(p.at)}`));
    let added = false;
    for (const { date, tracks } of days) {
      const day = dayOf(date);
      for (const t of tracks) {
        const key = `${t.id}@${day}`;
        if (heard.has(key)) continue;
        heard.add(key);
        this.add(t, { id: String(t.id), at: day + 12 * 60 * 60 * 1000, s: Math.round((t.durationMs || 0) / 1000), r: 1 });
        added = true;
      }
    }
    if (added) this.save();
  }

  /** Sums up the plays in [from, to). */
  recap({ from, to }: { from: number; to: number }): Recap {
    const plays = this.data.plays.filter((p) => p.at >= from && p.at < to);
    const tracks = new Map<string, { track: Track; plays: number; seconds: number }>();
    const artists = new Map<string, { artist: Artist; plays: number; seconds: number; track: Track; best: number }>();
    const genres = new Map<string, number>();
    const days = new Set<number>();
    let seconds = 0;
    for (const p of plays) {
      const track = this.data.tracks[p.id];
      if (!track) continue;
      seconds += p.s;
      days.add(dayOf(p.at));
      const t = tracks.get(p.id) ?? { track, plays: 0, seconds: 0 };
      t.plays++;
      t.seconds += p.s;
      tracks.set(p.id, t);
      const genre = track.albums?.[0]?.genre;
      if (genre) genres.set(genre, (genres.get(genre) ?? 0) + 1);
    }
    for (const t of tracks.values())
      for (const a of t.track.artists || []) {
        const key = String(a.id);
        const x = artists.get(key) ?? { artist: a, plays: 0, seconds: 0, track: t.track, best: 0 };
        x.plays += t.plays;
        x.seconds += t.seconds;
        if (t.plays > x.best) [x.best, x.track] = [t.plays, t.track];
        artists.set(key, x);
      }
    const byPlays = <T extends { plays: number; seconds: number }>(a: T, b: T) => b.plays - a.plays || b.seconds - a.seconds;
    return {
      plays: plays.length,
      minutes: seconds / 60,
      trackCount: tracks.size,
      artistCount: artists.size,
      days: days.size,
      tracks: [...tracks.values()].sort(byPlays),
      artists: [...artists.values()].sort(byPlays).map((x) => ({ artist: x.artist, plays: x.plays, seconds: x.seconds, track: x.track })),
      genres: [...genres].map(([genre, plays]) => ({ genre, plays })).sort((a, b) => b.plays - a.plays),
    };
  }

  private add(track: Track, play: LoggedPlay) {
    this.data.plays.push(play);
    this.data.tracks[play.id] = card(track);
  }

  private prune() {
    const cutoff = this.now() - KEEP_DAYS * DAY;
    this.data.plays = this.data.plays.filter((p) => p.at >= cutoff);
    const used = new Set(this.data.plays.map((p) => p.id));
    for (const id of Object.keys(this.data.tracks)) if (!used.has(id)) delete this.data.tracks[id];
  }

  private save() {
    this.prune();
    try {
      this.store.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full: the log is best effort */
    }
  }
}
