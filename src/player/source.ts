// What plays and where it comes from: the kinds of source (a wave, a list), their labels put in
// words when shown, and the keys a list's page knows itself by. No player state here (player.ts
// re-exports all of it).

import { tr } from '../i18n.ts';
import type { Mix } from '../recs/index.ts';
import type { Diversity, Language, Mood, WaveTuning } from '../wave/engine.ts';
import type { Origin } from './stats.ts';

export type Repeat = 'off' | 'all' | 'one';
/** A wave without a station is My Wave; with one it is a radio seeded by a track, artist, album or playlist. */
/** Where a list came from, reported to Yandex with each play so its history groups plays right. */
export interface PlayContext {
  /** "<uid>:<kind>" */
  playlist?: string;
  album?: number | string;
}
/**
 * What a list is, so its title is put in the interface language when it shows: the language may
 * change while it plays (the user switched to English, and the banner still said "Открытия недели").
 * Lists named by Yandex or the user (playlists, albums, artists) need none: their names stay.
 */
export type ListLabel =
  | { key: 'liked' | 'downloads' | 'history' | 'chart' | 'yearAgo' }
  /** With what was picked in "Tune" at the time (History says "My Wave · Rock · Upbeat": the user, 25.10.2026). */
  | { key: 'myWave'; picks?: WavePicks }
  | { key: 'search' | 'similar'; arg: string }
  | { key: 'mix'; mix: MixName }
  /** A station: `of` names what it plays from when that has a label ("Radio: Liked songs"). */
  | { key: 'radio'; title: string; of?: ListLabel };
/** What a mix's title is built from (components/Mixes.tsx, mixTitle). */
export type MixName = Pick<Mix, 'kind' | 'genre' | 'seedArtist' | 'slot' | 'slotStart' | 'builtAt' | 'rule'>;

export type Source =
  | { kind: 'wave'; station?: { seed: string; title: string; label?: ListLabel } }
  /**
   * `suggested`: ids Smart Shuffle added to the list (shown with ✦ in the queue);
   * `origin`: which recommendation it came from, for the stats in Settings.
   */
  | { kind: 'list'; title: string; from?: PlayContext; suggested?: string[]; origin?: Origin; list?: string; label?: ListLabel };

export interface PlayExtra {
  suggested?: string[];
  origin?: Origin;
  /** Which list this is, where `from` does not say (a mix, Downloads): its page shows it playing. */
  list?: string;
  label?: ListLabel;
}

/** The list playing, as its page names it: "playlist:<uid>:<kind>", "album:<id>", "mix:<id>", … */
export function listKeyOf(source: Source | null) {
  if (source?.kind !== 'list') return undefined;
  if (source.list) return source.list;
  if (source.from?.playlist) return `playlist:${source.from.playlist}`;
  if (source.from?.album !== undefined) return `album:${source.from.album}`;
  return undefined;
}

export function sourceTitle(source: Source | null) {
  if (source?.kind === 'list') return source.title;
  return source?.station ? tr().common.radioOf(source.station.title) : tr().common.myWave;
}

/** My Wave's Yandex-side picks, as keys (put in words when shown); the activity or genre by its name. */
export interface WavePicks {
  context?: string;
  diversity?: Diversity;
  mood?: Mood;
  language?: Language;
}

export function wavePicks(t: WaveTuning): WavePicks | undefined {
  const picks: WavePicks = {};
  if (t.context?.name) picks.context = t.context.name;
  if (t.diversity !== 'default') picks.diversity = t.diversity;
  if (t.mood !== 'all') picks.mood = t.mood;
  if (t.language !== 'any') picks.language = t.language;
  return Object.keys(picks).length ? picks : undefined;
}

export const isMyWave = (source: Source | null) => source?.kind === 'wave' && !source.station;
