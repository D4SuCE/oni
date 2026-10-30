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
/** Fewer different tracks than this a year ago: no "A year ago" card. */
const YEAR_AGO_MIN = 5;

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

/** Another device's log (src/sync, Yandex Disk): its own plays and their cards. */
export interface DeviceLog {
  plays: LoggedPlay[];
  tracks: Record<string, Track>;
}

export class PlayLog {
  private data: Stored;
  private remote: DeviceLog[] = [];
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

  /** The plays heard on this device (not the ones Yandex's history told of) with their cards, for Yandex Disk. */
  own(): DeviceLog {
    const plays = this.data.plays.filter((p) => !p.r);
    const tracks: Record<string, Track> = {};
    for (const p of plays) if (this.data.tracks[p.id]) tracks[p.id] = this.data.tracks[p.id];
    return { plays, tracks };
  }

  /** This device's own plays as its file on Disk keeps them: those missing here come back (src/sync). */
  restore(log: DeviceLog) {
    const have = new Set(this.data.plays.filter((p) => !p.r).map((p) => `${p.id}@${p.at}`));
    let back = false;
    for (const p of log.plays ?? []) {
      const track = log.tracks?.[p.id];
      if (p.r || !track || have.has(`${p.id}@${p.at}`)) continue;
      have.add(`${p.id}@${p.at}`);
      this.add(track, { id: p.id, at: p.at, s: p.s });
      back = true;
    }
    if (!back) return;
    this.data.plays.sort((a, b) => a.at - b.at);
    this.save();
  }

  /** The other devices' logs: recaps count their plays, read, never saved here. */
  setRemote(devices: DeviceLog[]) {
    this.remote = devices;
  }

  /** A play heard here: `seconds` it played. Written as it plays: the same play again (same start) only updates its length. */
  record(track: Track, at: number, seconds: number) {
    const id = String(track.id);
    const plays = this.data.plays;
    let same: LoggedPlay | undefined;
    for (let i = plays.length - 1; i >= 0 && !same; i--) if (plays[i].id === id && plays[i].at === at && !plays[i].r) same = plays[i];
    if (same) same.s = Math.round(seconds);
    else this.add(track, { id, at, s: Math.round(seconds) });
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

  /**
   * "A year ago you listened to": the most played of the same days a year ago (three days either
   * side), here and on the other devices; none below YEAR_AGO_MIN tracks (no card then).
   */
  yearAgo(): Track[] {
    const center = this.now() - 365 * DAY;
    const { tracks } = this.recap({ from: center - 3 * DAY, to: center + 4 * DAY });
    return tracks.length >= YEAR_AGO_MIN ? tracks.slice(0, 20).map((x) => x.track) : [];
  }

  /** How many times each track was heard in the last `days`, here and on the other devices. */
  timesHeard(days: number): Map<string, number> {
    const now = this.now();
    return new Map(this.recap({ from: now - days * DAY, to: now + 1 }).tracks.map((x) => [String(x.track.id), x.plays]));
  }

  /** Sums up the plays in [from, to). */
  recap({ from, to }: { from: number; to: number }): Recap {
    // Another Oni's own plays stand in for what Yandex's history told of the same track that day
    // (there: once, for the track's length; here: as heard).
    const theirs = this.remote.flatMap((d) => d.plays.filter((p) => !p.r && p.at >= from && p.at < to));
    const told = new Set(theirs.map((p) => `${p.id}@${dayOf(p.at)}`));
    const plays = [...this.data.plays.filter((p) => p.at >= from && p.at < to && !(p.r && told.has(`${p.id}@${dayOf(p.at)}`))), ...theirs];
    const tracks = new Map<string, { track: Track; plays: number; seconds: number }>();
    const artists = new Map<string, { artist: Artist; plays: number; seconds: number; track: Track; best: number }>();
    const genres = new Map<string, number>();
    const days = new Set<number>();
    let seconds = 0;
    for (const p of plays) {
      const track = this.data.tracks[p.id] ?? this.remote.find((d) => d.tracks[p.id])?.tracks[p.id];
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
