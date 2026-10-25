// Smart playlists (the user's pick, 24.10.2026: a section of their own beside "For you", "so they
// get used, not just exist"): lists made by plain rules from the user's own music — likes with
// their dates, plays, the artists they like — rebuilt every day. Unlike the mixes they are not
// shuffled or sampled: everything that fits the rule, in an order that says why it is there.

import type { Album, Track } from '../api/types.ts';
import type { Heard } from './personal.ts';
import { artistIds, DAY } from './util.ts';

export type SmartRule = 'likedMonth' | 'likedYearAgo' | 'mostPlayed' | 'newFromArtists';
/** The order they stand in on Home. */
// No "loved, not heard lately": it is "Forgotten favourites" again (the user, 25.10.2026).
export const SMART_RULES: SmartRule[] = ['likedMonth', 'newFromArtists', 'mostPlayed', 'likedYearAgo'];

/** A liked track and when it was liked (Yandex keeps the date of each like). */
export interface Like {
  track: Track;
  at: number;
}

const MAX = 100;
const playable = (t: Track, disliked: Set<string>) => t.available !== false && !disliked.has(String(t.id));

/** "Liked this month": the last 30 days of likes, newest first. */
export function likedMonth(likes: Like[], disliked: Set<string>, now: number): Track[] {
  return likes
    .filter((l) => now - l.at <= 30 * DAY && playable(l.track, disliked))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX)
    .map((l) => l.track);
}

/** "Liked a year ago": what was liked in these weeks a year ago (±3 weeks), in the order it was liked. */
export function likedYearAgo(likes: Like[], disliked: Set<string>, now: number): Track[] {
  return likes
    .filter((l) => Math.abs(now - 365 * DAY - l.at) <= 21 * DAY && playable(l.track, disliked))
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX)
    .map((l) => l.track);
}

/** "Most played": three plays or more, the most played first (the latest heard first among equals).
 * Over all time, where "On repeat" is the last month: shown only once they differ (differs()). */
export function mostPlayed(heard: Heard[], disliked: Set<string>, size = 50): Track[] {
  return heard
    .filter((h) => h.plays >= 3 && playable(h.track, disliked))
    .sort((a, b) => b.plays - a.plays || b.last - a.last)
    .slice(0, size)
    .map((h) => h.track);
}

/**
 * The user's artists, at most n (each costs a request): the ones followed, then by liked tracks
 * (two points each) and plays (one each, at most ten a track). Various artists are left out.
 */
export function myArtists(likes: Like[], heard: Heard[], followed: { id: number | string }[], n = 30): string[] {
  const weight = new Map<string, number>();
  const add = (t: Track, w: number) => {
    for (const id of artistIds(t)) weight.set(id, (weight.get(id) ?? 0) + w);
  };
  for (const l of likes) add(l.track, 2);
  for (const h of heard) add(h.track, Math.min(h.plays, 10));
  const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return [...new Set([...followed.map((a) => String(a.id)), ...ranked])].slice(0, n);
}

/** "New from my artists": whole releases of the last 30 days, the newest release first, each track once. */
export function newFromArtists(releases: { album: Album; tracks: Track[] }[], disliked: Set<string>, now: number): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>();
  const fresh = releases
    .filter(({ album }) => album.releaseDate && now - Date.parse(album.releaseDate) >= 0 && now - Date.parse(album.releaseDate) <= 30 * DAY)
    .sort((a, b) => Date.parse(b.album.releaseDate!) - Date.parse(a.album.releaseDate!));
  for (const { tracks } of fresh)
    for (const t of tracks) {
      const id = String(t.id);
      if (out.length >= MAX || seen.has(id) || !playable(t, disliked)) continue;
      seen.add(id);
      out.push(t);
    }
  return out;
}

/** More than half of `a` is not in `b`: "Most played" is shown only when it is not "On repeat" again
 * (with a month of plays or less they are the same; the user, 25.10.2026). */
export function differs(a: Track[], b: Track[]) {
  const other = new Set(b.map((t) => String(t.id)));
  return a.filter((t) => !other.has(String(t.id))).length * 2 > a.length;
}
