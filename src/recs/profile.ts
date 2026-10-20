// Taste profile: how much the user cares about each track, artist and genre,
// from likes and from what they actually listen to (and skip) in this app.

import type { Track } from '../api/types.ts';
import type { HistoryEntry } from '../wave/history.ts';
import { DAY, trackGenre } from './util.ts';

export interface GenreTree {
  /** Top-level genre for any genre or sub-genre id. */
  parent: Record<string, string>;
  title: Record<string, string>;
}

export interface TasteInput {
  /** Liked tracks, newest like first. */
  liked: Track[];
  /** Tracks from the local listening history, with their history entries. */
  heard: { track: Track; entry: HistoryEntry }[];
  disliked: Set<string>;
  now: number;
}

export interface WeightedTrack {
  track: Track;
  weight: number;
  liked: boolean;
}

export interface Profile {
  tracks: Map<string, WeightedTrack>;
  artists: Map<string, { name: string; weight: number }>;
  /** By top-level genre. */
  genres: Map<string, number>;
}

/** Listening counts for half as much after this many days. */
export const HALF_LIFE_DAYS = 30;
const LIKE_WEIGHT = 3;
const PLAY_WEIGHT = 1;
const SKIP_WEIGHT = 2;
const MAX_COUNTED_PLAYS = 10;

const decay = (ageMs: number) => Math.pow(0.5, ageMs / DAY / HALF_LIFE_DAYS);

export function buildProfile(input: TasteInput, tree: GenreTree): Profile {
  const tracks = new Map<string, WeightedTrack>();
  const add = (track: Track, weight: number, liked = false) => {
    const id = String(track.id);
    if (input.disliked.has(id) || track.available === false) return;
    const cur = tracks.get(id);
    if (cur) {
      cur.weight += weight;
      cur.liked ||= liked;
    } else tracks.set(id, { track, weight, liked });
  };

  // Newer likes say more about the current taste: weight goes from 3 (newest) to 1.5 (oldest).
  input.liked.forEach((t, i) => add(t, LIKE_WEIGHT * (1 - (0.5 * i) / Math.max(input.liked.length, 1)), true));

  for (const { track, entry } of input.heard) {
    const fresh = decay(input.now - entry.last);
    add(track, (Math.min(entry.plays, MAX_COUNTED_PLAYS) * PLAY_WEIGHT - entry.skips * SKIP_WEIGHT) * fresh);
  }
  for (const [id, t] of tracks) if (t.weight <= 0) tracks.delete(id);

  const artists = new Map<string, { name: string; weight: number }>();
  const genres = new Map<string, number>();
  for (const { track, weight } of tracks.values()) {
    const own = (track.artists || []).filter((a) => !a.various);
    for (const a of own) {
      const id = String(a.id);
      const cur = artists.get(id) ?? { name: a.name, weight: 0 };
      cur.weight += weight / own.length;
      artists.set(id, cur);
    }
    const g = trackGenre(track);
    if (g) {
      const top = tree.parent[g] ?? g;
      genres.set(top, (genres.get(top) ?? 0) + weight);
    }
  }
  return { tracks, artists, genres };
}

export function topArtists(profile: Profile, n: number) {
  return [...profile.artists.entries()]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, n)
    .map(([id, a]) => ({ id, name: a.name, weight: a.weight }));
}
