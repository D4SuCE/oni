// «Своя волна» (the user's last pick, 24–25.10.2026): Oni's own station beside My Wave, made from the
// user's music rather than Yandex's model. Four pools — favourites (likes, much played), similar to
// what is liked and heard now, forgotten hits (old likes quiet for weeks), fresh releases of the
// user's artists — mixed by a share the user sets (familiar · balanced · new). It learns within the
// session harder than My Wave: a track heard to the end or liked brings its similar ones next and
// lifts its artist; one skipped in its first 30 s pulls the artist down, twice — the artist is out
// for the session. The account's dislikes and "Skipped" (recs/feedback.ts) always apply.

import type { Track, WaveEventType } from '../api/types.ts';
import type { Heard } from '../recs/personal.ts';
import type { Like } from '../recs/smart.ts';
import { DAY } from '../recs/util.ts';
import type { RejectReason, Station, WaveStats, WaveTuning } from './engine.ts';
import type { ListenHistory } from './history.ts';

export type OwnMode = 'familiar' | 'balanced' | 'fresh';
export const OWN_MODES: OwnMode[] = ['familiar', 'balanced', 'fresh'];
/** The station's seed in the player's source: `{ kind: 'wave', station: { seed: OWN_SEED, … } }`. */
export const OWN_SEED = 'oni:own';

type Pool = 'favorite' | 'forgotten' | 'similar' | 'fresh';
const POOLS: Pool[] = ['favorite', 'forgotten', 'similar', 'fresh'];

/** How much of each pool, by mode. */
export const MIX: Record<OwnMode, Record<Pool, number>> = {
  familiar: { favorite: 0.5, forgotten: 0.2, similar: 0.2, fresh: 0.1 },
  balanced: { favorite: 0.3, forgotten: 0.1, similar: 0.45, fresh: 0.15 },
  fresh: { favorite: 0.1, forgotten: 0.05, similar: 0.6, fresh: 0.25 },
};

/** Where the station's tracks come from (recs/index.ts gives the real ones; tests give their own). */
export interface OwnSources {
  /** Liked tracks with the date of each like. */
  likes(): Promise<Like[]>;
  /** Plays on every device: how many, the last one. */
  heard(): Promise<Heard[]>;
  similar(t: Track): Promise<Track[]>;
  /** New releases of the user's artists, the newest first. */
  releases(): Promise<Track[]>;
}

interface Candidate {
  track: Track;
  pool: Pool;
  score: number;
  /** The track it is similar to: skipped early, the rest of its kind goes too. */
  seed?: string;
}

/** A favourite is not played again within this many days (a station of the same twenty songs tires). */
const FAVOURITE_REST = 3;
/** A like this old, quiet this long, is a forgotten hit. */
const FORGOTTEN_LIKED = 90;
const FORGOTTEN_QUIET = 45;
/** A similar track heard within this many days is not "new" enough to offer. */
const SIMILAR_QUIET = 30;
/** Nothing is played twice within half a day, whatever the pools hold. */
const ANY_REST = 0.5;
/** An early skip: within the first seconds of a track. */
const EARLY_SKIP = 30;
const ARTIST_GAP = 3;
/** Similar tracks asked for at the start, from what is liked and heard now. */
const START_SEEDS = 6;

const artistsOf = (t: Track) => (t.artists || []).filter((a) => !a.various).map((a) => String(a.id));

export class OwnWave implements Station {
  readonly tuning: WaveTuning;
  mode: OwnMode;
  isSkipped?: (t: Track) => boolean;
  stats: WaveStats = {
    received: 0,
    given: 0,
    rejected: { recent: 0, overplayed: 0, skipped: 0, disliked: 0, duplicate: 0, unavailable: 0 },
    deferredByArtist: 0,
    relaxed: 0,
  };
  readonly radio = undefined;

  private sources: OwnSources;
  private history: ListenHistory;
  private isDisliked: (id: string) => boolean;
  private rand: () => number;
  private now: () => number;
  private pools = new Map<Pool, Candidate[]>(POOLS.map((p) => [p, []]));
  /** Every track already in a pool or played: each comes once. */
  private known = new Set<string>();
  private given = new Set<string>();
  private recentArtists: string[][] = [];
  /** Within the session: + heard to the end or liked, − skipped early. */
  private artistMood = new Map<string, number>();
  private muted = new Set<string>();
  private liked = new Set<string>();
  private started: Promise<void> | null = null;
  /** Similar tracks still on their way (heard to the end, liked): not waited for by next(). */
  private asked = new Set<string>();

  constructor(
    sources: OwnSources,
    history: ListenHistory,
    tuning: WaveTuning,
    mode: OwnMode = 'balanced',
    isDisliked: (id: string) => boolean = () => false,
    rand: () => number = Math.random,
    now: () => number = () => Date.now(),
  ) {
    this.sources = sources;
    this.history = history;
    this.tuning = { ...tuning };
    this.mode = mode;
    this.isDisliked = isDisliked;
    this.rand = rand;
    this.now = now;
  }

  start(): Promise<void> {
    this.started ??= this.load();
    return this.started;
  }

  private async load() {
    const [likes, heard] = await Promise.all([this.sources.likes().catch(() => [] as Like[]), this.sources.heard().catch(() => [] as Heard[])]);
    const now = this.now();
    for (const l of likes) this.liked.add(String(l.track.id));
    const plays = new Map(heard.map((h) => [String(h.track.id), h]));
    // Likes: a forgotten hit if liked long ago and quiet for weeks, else a favourite; the fresher
    // the like and the more it was played, the likelier.
    for (const l of likes) {
      const id = String(l.track.id);
      const h = plays.get(id);
      const quiet = this.quietDays(l.track);
      if (now - l.at >= FORGOTTEN_LIKED * DAY && quiet >= FORGOTTEN_QUIET) this.add({ track: l.track, pool: 'forgotten', score: 1 + Math.min(h?.plays ?? 0, 10) / 5 });
      else this.add({ track: l.track, pool: 'favorite', score: 1 + (now - l.at < 90 * DAY ? 1 : 0) + Math.min(h?.plays ?? 0, 10) / 4 });
    }
    // Much played, not liked: a favourite too.
    for (const h of heard) if (h.plays >= 3) this.add({ track: h.track, pool: 'favorite', score: 1 + Math.min(h.plays, 10) / 4 });
    // Similar to what is played now and to the latest likes: asked now, not waited for (the first
    // track is a favourite; the player gives a wave 15 s to start, and the cloud iPhone missed it).
    const seeds = [
      ...heard.filter((h) => now - h.last < 14 * DAY).sort((a, b) => b.plays - a.plays).slice(0, START_SEEDS - 2).map((h) => h.track),
      ...likes.slice(0, 2).map((l) => l.track),
    ];
    for (const t of new Map(seeds.map((t) => [String(t.id), t])).values()) void this.askSimilar(t, 1);
    // Releases come in their own time (a request per artist): the station does not wait for them.
    this.sources
      .releases()
      .then((tracks) => tracks.forEach((t, i) => this.add({ track: t, pool: 'fresh', score: 2 - i / Math.max(tracks.length, 1) })))
      .catch(() => {});
  }

  private quietDays(t: Track) {
    return this.history.daysSince(t);
  }

  private add(c: Candidate) {
    const id = String(c.track.id);
    if (this.known.has(id) || c.track.available === false) return;
    if (c.pool === 'similar' && (this.liked.has(id) || this.quietDays(c.track) < SIMILAR_QUIET)) return;
    if (c.pool === 'fresh' && this.quietDays(c.track) < Infinity) return;
    this.known.add(id);
    this.stats.received++;
    this.pools.get(c.pool)!.push(c);
  }

  private async askSimilar(t: Track, score: number) {
    const id = String(t.id);
    if (this.asked.has(id)) return;
    this.asked.add(id);
    const similar = await this.sources.similar(t).catch(() => [] as Track[]);
    // Fresh momentum first: what came of the latest heard track stands before older similar ones.
    const pool = this.pools.get('similar')!;
    const before = pool.length;
    similar.forEach((s) => this.add({ track: s, pool: 'similar', score, seed: id }));
    if (score > 1) pool.unshift(...pool.splice(before));
  }

  rejectReason(t: Track): RejectReason | null {
    const id = String(t.id);
    if (t.available === false) return 'unavailable';
    if (this.isDisliked(id)) return 'disliked';
    if (this.isSkipped?.(t) || artistsOf(t).some((a) => this.muted.has(a))) return 'skipped';
    return null;
  }

  /** May it play now: not given yet, not rejected, not too recent, its artist not too close. */
  private fits(c: Candidate, gap: number) {
    if (this.given.has(String(c.track.id)) || this.rejectReason(c.track)) return false;
    const quiet = this.quietDays(c.track);
    if (quiet < ANY_REST || (c.pool === 'favorite' && quiet < FAVOURITE_REST)) return false;
    const near = new Set(this.recentArtists.slice(-gap).flat());
    return !artistsOf(c.track).some((a) => near.has(a));
  }

  private weight(c: Candidate) {
    const mood = artistsOf(c.track).reduce((m, a) => m + (this.artistMood.get(a) ?? 0), 0);
    return c.score * Math.pow(mood >= 0 ? 1.6 : 0.35, Math.abs(mood));
  }

  /** A weighted pick of what fits in a pool (heavier ones likelier, not always first). */
  private pickFrom(pool: Pool, gap: number): Candidate | null {
    const list = this.pools.get(pool)!.filter((c) => this.fits(c, gap));
    if (!list.length) return null;
    const total = list.reduce((s, c) => s + this.weight(c), 0);
    let r = this.rand() * total;
    for (const c of list) if ((r -= this.weight(c)) <= 0) return c;
    return list[list.length - 1];
  }

  /** The pools in the order to try: one drawn by the mode's shares, then the rest by share. */
  private poolOrder(): Pool[] {
    const share = MIX[this.mode];
    const open = POOLS.filter((p) => this.pools.get(p)!.length);
    const total = open.reduce((s, p) => s + share[p], 0);
    let r = this.rand() * total;
    const first = open.find((p) => (r -= share[p]) <= 0) ?? open[0];
    return [first, ...open.filter((p) => p !== first).sort((a, b) => share[b] - share[a])].filter(Boolean);
  }

  async next(): Promise<Track | null> {
    await this.start();
    for (const gap of [ARTIST_GAP, 0]) {
      for (const pool of this.poolOrder()) {
        const c = this.pickFrom(pool, gap);
        if (!c) continue;
        if (gap === 0) this.stats.deferredByArtist++;
        return this.give(c);
      }
    }
    return null;
  }

  private give(c: Candidate) {
    const id = String(c.track.id);
    this.given.add(id);
    const list = this.pools.get(c.pool)!;
    list.splice(list.indexOf(c), 1);
    this.stats.given++;
    this.recentArtists.push(artistsOf(c.track));
    if (this.recentArtists.length > 20) this.recentArtists.shift();
    return c.track;
  }

  private mood(t: Track, by: number) {
    for (const a of artistsOf(t)) this.artistMood.set(a, Math.max(-3, Math.min(3, (this.artistMood.get(a) ?? 0) + by)));
  }

  feedback(type: WaveEventType, track?: Track, playedSeconds = 0) {
    if (!track) return;
    const id = String(track.id);
    if (type === 'trackFinished') {
      this.mood(track, 1);
      void this.askSimilar(track, 1.5);
    } else if (type === 'like') {
      this.liked.add(id);
      this.mood(track, 2);
      void this.askSimilar(track, 2);
    } else if (type === 'dislike') {
      for (const a of artistsOf(track)) this.muted.add(a);
    } else if (type === 'skip' && playedSeconds < EARLY_SKIP) {
      this.mood(track, -1);
      for (const a of artistsOf(track)) if ((this.artistMood.get(a) ?? 0) <= -2) this.muted.add(a);
      // What came for its sake goes too: skipped early, it was not what was wanted.
      const similar = this.pools.get('similar')!;
      this.pools.set('similar', similar.filter((c) => c.seed !== id));
    }
  }
}
