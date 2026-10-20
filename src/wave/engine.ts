// "Моя волна" with an anti-repeat layer on top. Yandex picks the candidates;
// we decide which of them are actually worth playing.

import type { Track, WaveBatch, WaveEventType } from '../api/types.ts';
import { trackKey } from '../api/yandex.ts';
import type { ListenHistory } from './history.ts';

export interface WaveApi {
  waveStart(seeds: string[]): Promise<WaveBatch>;
  waveMore(sessionId: string, queue: string[]): Promise<WaveBatch>;
  waveFeedback(sessionId: string, batchId: string, type: WaveEventType, track?: Track, playedSeconds?: number): Promise<void>;
}

export type Diversity = 'default' | 'favorite' | 'discover' | 'popular';
export type Mood = 'all' | 'active' | 'fun' | 'calm' | 'sad';
export type Language = 'any' | 'russian' | 'not-russian' | 'without-words';

export interface WaveTuning {
  // Sent to Yandex
  diversity: Diversity;
  mood: Mood;
  language: Language;
  context: { type: string; tag: string; name: string } | null;
  // Applied locally
  /** Skip tracks heard within this many days (0 = off). */
  noRepeatDays: number;
  /** Skip tracks heard this many times or more in total (0 = off). */
  maxPlays: number;
  /** Skip tracks the user skipped early at least twice. */
  hideSkipped: boolean;
  /** Minimum number of other tracks between two tracks of the same artist (0 = off). */
  artistGap: number;
  /** Only tracks never heard before. */
  onlyNew: boolean;
}

export const DEFAULT_TUNING: WaveTuning = {
  diversity: 'default',
  mood: 'all',
  language: 'any',
  context: null,
  noRepeatDays: 7,
  maxPlays: 0,
  hideSkipped: true,
  artistGap: 3,
  onlyNew: false,
};

export type RejectReason = 'recent' | 'overplayed' | 'skipped' | 'disliked' | 'duplicate' | 'unavailable';

export interface WaveStats {
  received: number;
  given: number;
  rejected: Record<RejectReason, number>;
  deferredByArtist: number;
}

const MAX_FETCHES_PER_NEXT = 6;
const QUEUE_CONTEXT = 150;

export function waveSeeds(t: WaveTuning): string[] {
  const seeds = [t.context ? `${t.context.type}:${t.context.tag}` : 'user:onyourwave'];
  if (t.diversity !== 'default') seeds.push(`settingDiversity:${t.diversity}`);
  if (t.mood !== 'all') seeds.push(`settingMoodEnergy:${t.mood}`);
  if (t.language !== 'any') seeds.push(`settingLanguage:${t.language}`);
  return seeds;
}

export class WaveEngine {
  readonly tuning: WaveTuning;
  stats: WaveStats = {
    received: 0,
    given: 0,
    rejected: { recent: 0, overplayed: 0, skipped: 0, disliked: 0, duplicate: 0, unavailable: 0 },
    deferredByArtist: 0,
  };

  private api: WaveApi;
  private history: ListenHistory;
  private isDisliked: (id: string) => boolean;
  private session: { id: string; batchId: string } | null = null;
  private delivered: string[] = [];
  private seen = new Set<string>();
  private pending: Track[] = [];
  /** Rejected only for being a repeat — the fallback if Yandex runs dry. */
  private reserve: Track[] = [];
  private recentArtists: string[][] = [];

  /** Fixed seeds for a station radio (track:<id>, artist:<id>, …); My Wave derives them from the tuning. */
  private stationSeeds: string[] | null;

  constructor(api: WaveApi, history: ListenHistory, tuning: WaveTuning, isDisliked: (id: string) => boolean = () => false, stationSeeds: string[] | null = null) {
    this.api = api;
    this.history = history;
    this.tuning = tuning;
    this.isDisliked = isDisliked;
    this.stationSeeds = stationSeeds;
  }

  async start() {
    const batch = await this.api.waveStart(this.stationSeeds ?? waveSeeds(this.tuning));
    this.session = { id: batch.sessionId, batchId: batch.batchId };
    this.feedback('radioStarted');
    this.ingest(batch);
  }

  async next(): Promise<Track | null> {
    if (!this.session) await this.start();
    for (let attempt = 0; attempt <= MAX_FETCHES_PER_NEXT; attempt++) {
      const t = this.takeAllowed();
      if (t) return this.give(t);
      if (attempt < MAX_FETCHES_PER_NEXT) await this.fetchMore();
    }
    // Filters are too strict for what Yandex offers right now: relax gracefully.
    const fallback = this.pending.shift() || this.takeOldestReserve();
    return fallback ? this.give(fallback) : null;
  }

  /** Report a playback event to Yandex so its own model learns too. Never throws. */
  feedback(type: WaveEventType, track?: Track, playedSeconds?: number) {
    if (!this.session) return;
    this.api.waveFeedback(this.session.id, this.session.batchId, type, track, playedSeconds).catch(() => {});
  }

  rejectReason(t: Track): RejectReason | null {
    const id = String(t.id);
    if (t.available === false) return 'unavailable';
    if (this.isDisliked(id)) return 'disliked';
    const h = this.history.get(id);
    if (!h) return null;
    const tune = this.tuning;
    if (tune.hideSkipped && h.skips >= 2 && h.plays === 0) return 'skipped';
    if (tune.onlyNew && h.plays > 0) return 'recent';
    if (tune.maxPlays > 0 && h.plays >= tune.maxPlays) return 'overplayed';
    if (tune.noRepeatDays > 0 && h.plays > 0 && this.history.daysSince(id) < tune.noRepeatDays) return 'recent';
    return null;
  }

  private ingest(batch: WaveBatch) {
    this.session = { id: batch.sessionId, batchId: batch.batchId };
    for (const { track } of batch.items) {
      const key = trackKey(track);
      this.delivered.push(key);
      this.stats.received++;
      if (this.seen.has(String(track.id))) {
        this.stats.rejected.duplicate++;
        continue;
      }
      this.seen.add(String(track.id));
      const reason = this.rejectReason(track);
      if (!reason) this.pending.push(track);
      else {
        this.stats.rejected[reason]++;
        if (reason === 'recent' || reason === 'overplayed') this.reserve.push(track);
      }
    }
  }

  private async fetchMore() {
    if (!this.session) return;
    const batch = await this.api.waveMore(this.session.id, this.delivered.slice(-QUEUE_CONTEXT));
    this.ingest(batch);
  }

  private artistsOf(t: Track) {
    return (t.artists || []).map((a) => String(a.id));
  }

  private artistAllowed(t: Track) {
    const gap = this.tuning.artistGap;
    if (gap <= 0) return true;
    const recent = new Set(this.recentArtists.slice(-gap).flat());
    return !this.artistsOf(t).some((a) => recent.has(a));
  }

  private takeAllowed(): Track | null {
    const i = this.pending.findIndex((t) => this.artistAllowed(t));
    if (i < 0) {
      if (this.pending.length) this.stats.deferredByArtist++;
      return null;
    }
    if (i > 0) this.stats.deferredByArtist++;
    return this.pending.splice(i, 1)[0];
  }

  private takeOldestReserve(): Track | null {
    if (!this.reserve.length) return null;
    this.reserve.sort((a, b) => this.history.daysSince(String(b.id)) - this.history.daysSince(String(a.id)));
    return this.reserve.shift()!;
  }

  private give(t: Track) {
    this.stats.given++;
    this.recentArtists.push(this.artistsOf(t));
    if (this.recentArtists.length > 50) this.recentArtists.shift();
    return t;
  }
}
