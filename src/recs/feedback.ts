// What the user told the mixes without a dislike (which would go to Yandex for the whole
// account): tracks hidden from the mixes, tracks skipped twice and never heard ("Skipped", the
// user's idea), and artists demoted after two skips in a row. Applied to every mix when it is
// shown, so it works at once, without a rebuild; the skipped and hidden also leave My Wave.
//
// Shared by every device of the account (the user, 25.10.2026: the lists differed on the PC and the
// phone; "and a Mac later is one more device"): each decision — hidden, left out, demoted, brought
// back — is a mark with its time, sent in the device's file on Disk (sync/devices.ts); for each
// track or artist the latest mark wins on every device, so "Back" on one brings it back on all.

import type { Track } from '../api/types.ts';
import { trimTrack } from '../player/recent.ts';
import type { KeyValueStore } from '../wave/history.ts';
import { DAY } from './util.ts';

export type PlayOutcome = 'skipped' | 'finished' | 'partial';

interface ArtistState {
  name: string;
  /** Skips in a row of this artist's tracks. */
  streak: number;
  demotedUntil?: number;
}

/** A track's skips where they count (the wave, radios, mixes); `heard`: once past 30 s, never left out for skips. */
interface TrackSkips {
  n: number;
  heard?: true;
  /** Left out until then (ms). */
  until?: number;
}

/** A decision on a track (`t:<id>`) or an artist (`a:<id>`), the latest one winning across devices. */
export interface Mark {
  s: 'hidden' | 'out' | 'back';
  at: number;
  /** Left out until then (ms). */
  until?: number;
  /** An artist's name, for the list. */
  name?: string;
}

/** What a device shares: its marks, and the cards of the tracks they name (for the list). */
export interface SharedFeedback {
  marks: Record<string, Mark>;
  cards: Record<string, Track>;
}

interface Saved {
  marks?: Record<string, Mark>;
  hidden: string[];
  artists: Record<string, ArtistState>;
  tracks?: Record<string, TrackSkips>;
  /** Cards of the hidden and the left out, for the list in Settings. */
  cards?: Record<string, Track>;
}

export interface DemotedArtist {
  id: string;
  name: string;
  /** Back in the mixes then (ms). */
  until: number;
}

export interface SkippedEntry {
  track: Track;
  /** Hidden by hand: for good. */
  manual: boolean;
  /** Skipped: back then (ms). */
  until?: number;
}

const KEY = 'recs.feedback.v1';
/** Two skips in a row demote an artist… */
const DEMOTE_AFTER = 2;
/** …for this long. */
const DEMOTE_FOR = 30 * DAY;
/** A track skipped twice in its first 30 s and never heard is left out this long (the user's choice). */
const SKIPPED_FOR = 182 * DAY;
/** A "back" is kept this long, so a device away for a while still learns of it. */
const BACK_KEPT = 182 * DAY;

export class RecsFeedback {
  private hidden: Set<string>;
  private artists: Record<string, ArtistState>;
  private tracks: Record<string, TrackSkips>;
  private cards: Record<string, Track>;
  private marks: Record<string, Mark>;
  private store: KeyValueStore;
  private now: () => number;
  private listeners = new Set<() => void>();

  constructor(store: KeyValueStore, now = () => Date.now()) {
    this.store = store;
    this.now = now;
    let saved: Partial<Saved> = {};
    try {
      saved = JSON.parse(store.getItem(KEY) || '{}');
    } catch {
      /* start over */
    }
    this.hidden = new Set(saved.hidden ?? []);
    this.artists = saved.artists ?? {};
    this.tracks = saved.tracks ?? {};
    this.cards = saved.cards ?? {};
    this.marks = saved.marks ?? {};
    // Kept before the lists were shared: marked as of the very beginning, so on the first exchange
    // the devices' lists come together and any decision made since wins over them.
    if (!saved.marks) {
      for (const id of this.hidden) this.marks[`t:${id}`] = { s: 'hidden', at: 1 };
      for (const [id, s] of Object.entries(this.tracks)) if (s.until && !this.hidden.has(id)) this.marks[`t:${id}`] = { s: 'out', at: 1, until: s.until };
      for (const [id, s] of Object.entries(this.artists)) if (s.demotedUntil) this.marks[`a:${id}`] = { s: 'out', at: 1, until: s.demotedUntil, name: s.name };
    }
  }

  /** `changed`: what the mixes keep is different now, so listeners are told. */
  private save(changed: boolean) {
    this.store.setItem(KEY, JSON.stringify({ marks: this.marks, hidden: [...this.hidden], artists: this.artists, tracks: this.tracks, cards: this.cards } satisfies Saved));
    if (changed) for (const fn of this.listeners) fn();
  }

  /** Called when a track is hidden, an artist demoted, or everything brought back; returns the unsubscribe function. */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  hide(track: Track) {
    const id = String(track.id);
    this.hidden.add(id);
    this.cards[id] = trimTrack(track);
    this.marks[`t:${id}`] = { s: 'hidden', at: this.now() };
    this.save(true);
  }

  isHidden(trackId: string | number) {
    return this.hidden.has(String(trackId));
  }

  /** Hidden by hand, or skipped twice and not yet back. */
  isSkipped(trackId: string | number, now: number) {
    const id = String(trackId);
    const until = this.tracks[id]?.until;
    return this.hidden.has(id) || Boolean(until && until > now);
  }

  /**
   * A play ended. A skip adds to the streak of each of the track's artists, and the second in a
   * row demotes them; any other ending clears the streak (and lifts nothing early).
   * The track's own skips count only from the wave, radios and mixes (`mine`: own playlists,
   * Liked, or a liked track, where a skip says nothing against it): the second one with the track
   * never heard past 30 s leaves it out for half a year. Returns the artists demoted by this play.
   */
  recordPlay(track: Track, outcome: PlayOutcome, now: number, mine = false): string[] {
    const own = this.countSkip(track, outcome, now, mine);
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
          this.marks[`a:${id}`] = { s: 'out', at: now, until: cur.demotedUntil, name: a.name };
          demoted.push(a.name);
        }
      } else cur.streak = 0;
      this.artists[id] = cur;
    }
    // Forget artists with nothing to remember, so the record stays small.
    for (const [id, s] of Object.entries(this.artists)) if (!s.streak && !(s.demotedUntil && s.demotedUntil > now)) delete this.artists[id];
    this.save(demoted.length > 0 || own);
    return demoted;
  }

  /** True when the track is left out by this play. */
  private countSkip(track: Track, outcome: PlayOutcome, now: number, mine: boolean) {
    const id = String(track.id);
    const cur = this.tracks[id];
    if (outcome !== 'skipped') {
      if (!cur?.heard) this.tracks[id] = { n: cur?.n ?? 0, heard: true };
      return false;
    }
    if (mine || cur?.heard) return false;
    const next: TrackSkips = { n: (cur?.n ?? 0) + 1 };
    this.tracks[id] = next;
    if (next.n < 2) return false;
    next.until = now + SKIPPED_FOR;
    this.cards[id] = trimTrack(track);
    this.marks[`t:${id}`] = { s: 'out', at: now, until: next.until };
    return true;
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

  /** Demoted artists, each with the day it ends, for the list in Settings (by name). */
  demotedList(now: number): DemotedArtist[] {
    return Object.entries(this.artists)
      .filter(([id]) => this.isDemoted(id, now))
      .map(([id, s]) => ({ id, name: s.name, until: s.demotedUntil! }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** An artist back in the mixes before its 30 days are up; its skips count from the start. */
  liftArtist(artistId: string | number) {
    delete this.artists[String(artistId)];
    this.marks[`a:${artistId}`] = { s: 'back', at: this.now() };
    this.save(true);
  }

  /** The hidden and the left out, by name, for the list in Settings. */
  skippedList(now: number): SkippedEntry[] {
    const out: SkippedEntry[] = [];
    for (const id of this.hidden) if (this.cards[id]) out.push({ track: this.cards[id], manual: true });
    for (const [id, s] of Object.entries(this.tracks)) {
      if (this.hidden.has(id) || !s.until || s.until <= now || !this.cards[id]) continue;
      out.push({ track: this.cards[id], manual: false, until: s.until });
    }
    return out.sort((a, b) => a.track.title.localeCompare(b.track.title));
  }

  hiddenCount(now = Date.now()) {
    let n = this.hidden.size;
    for (const [id, s] of Object.entries(this.tracks)) if (!this.hidden.has(id) && s.until && s.until > now) n++;
    return n;
  }

  /** Back in the mixes and the wave; its skips count from the start. */
  bringBack(trackId: string | number) {
    const id = String(trackId);
    this.hidden.delete(id);
    delete this.tracks[id];
    delete this.cards[id];
    this.marks[`t:${id}`] = { s: 'back', at: this.now() };
    this.save(true);
  }

  /** Whether a track may appear in a mix: not hidden, not skipped, and none of its artists demoted. */
  keeps(track: Track, now: number) {
    return !this.isSkipped(track.id, now) && !(track.artists || []).some((a) => !a.various && this.isDemoted(a.id, now));
  }

  /** Brings back every hidden and skipped track and demoted artist. */
  reset() {
    // "Back" for each, so the other devices bring them back too.
    const at = this.now();
    for (const key of Object.keys(this.marks)) if (this.marks[key].s !== 'back') this.marks[key] = { s: 'back', at };
    for (const id of this.hidden) this.marks[`t:${id}`] = { s: 'back', at };
    for (const id of Object.keys(this.tracks)) if (this.tracks[id].until) this.marks[`t:${id}`] = { s: 'back', at };
    for (const id of Object.keys(this.artists)) if (this.artists[id].demotedUntil) this.marks[`a:${id}`] = { s: 'back', at };
    this.hidden.clear();
    this.artists = {};
    this.tracks = {};
    this.cards = {};
    this.save(true);
  }

  /** What this device shares with the others: the marks still worth knowing, and their tracks' cards. */
  own(): SharedFeedback {
    const now = this.now();
    for (const [key, m] of Object.entries(this.marks)) {
      // A "left out" over, or an old "back": nothing to tell any more.
      if ((m.s === 'out' && (m.until ?? 0) <= now) || (m.s === 'back' && now - m.at > BACK_KEPT)) delete this.marks[key];
    }
    const cards: Record<string, Track> = {};
    for (const [key, m] of Object.entries(this.marks)) if (key.startsWith('t:') && m.s !== 'back' && this.cards[key.slice(2)]) cards[key.slice(2)] = this.cards[key.slice(2)];
    return { marks: { ...this.marks }, cards };
  }

  /** The other devices' marks: each later than this one's is taken (and kept, so it is passed on). */
  setRemote(devices: SharedFeedback[]) {
    let changed = false;
    for (const d of devices)
      for (const [key, m] of Object.entries(d.marks ?? {})) {
        if (!m || (this.marks[key]?.at ?? -1) >= m.at) continue;
        this.take(key, m, d.cards?.[key.slice(2)]);
        changed = true;
      }
    if (changed) this.save(true);
  }

  private take(key: string, m: Mark, card?: Track) {
    this.marks[key] = m;
    const id = key.slice(2);
    if (key.startsWith('a:')) {
      if (m.s === 'out') this.artists[id] = { name: m.name ?? this.artists[id]?.name ?? id, streak: 0, demotedUntil: m.until };
      else delete this.artists[id];
      return;
    }
    if (m.s === 'back') {
      this.hidden.delete(id);
      delete this.tracks[id];
      delete this.cards[id];
      return;
    }
    if (card) this.cards[id] = card;
    if (m.s === 'hidden') this.hidden.add(id);
    else this.tracks[id] = { n: Math.max(2, this.tracks[id]?.n ?? 0), until: m.until };
  }
}

/** Outcome of a play the way the stats count it: skipped within 30 s, finished at the end or 85%. */
export function playOutcome(listened: number, duration: number, ended: boolean): PlayOutcome {
  if (ended || (duration > 0 && listened >= duration * 0.85)) return 'finished';
  return listened < 30 ? 'skipped' : 'partial';
}
