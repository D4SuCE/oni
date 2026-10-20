// Personal lists built from what the user already listens to (no new candidates):
// "On repeat" (most played lately), "Forgotten favourites" (loved, not heard for a while),
// and the seed artists for "Because you listened to …".

import type { Track } from '../api/types.ts';
import { DAY, artistIds, spreadArtists, weightedOrder } from './util.ts';

export interface Heard {
  track: Track;
  plays: number;
  last: number;
}

/** Most played in the last `days`, at least two plays each; most played first. */
export function onRepeat(heard: Heard[], disliked: Set<string>, now: number, size = 30, days = 30): Track[] {
  return heard
    .filter((h) => h.plays >= 2 && now - h.last <= days * DAY && !disliked.has(String(h.track.id)) && h.track.available !== false)
    .sort((a, b) => b.plays - a.plays || b.last - a.last)
    .slice(0, size)
    .map((h) => h.track);
}

/**
 * Loved once, quiet for at least `quietDays`: liked tracks (older likes count more) and
 * tracks that used to be played a lot. A different draw every week.
 */
export function forgottenFavourites(
  liked: Track[],
  heard: Heard[],
  daysSinceHeard: (id: string) => number,
  disliked: Set<string>,
  rand: () => number,
  size = 30,
  quietDays = 45,
): Track[] {
  const score = new Map<string, { track: Track; score: number }>();
  liked.forEach((t, i) => score.set(String(t.id), { track: t, score: 1 + (2 * i) / Math.max(liked.length, 1) }));
  for (const h of heard) {
    const id = String(h.track.id);
    const cur = score.get(id) ?? { track: h.track, score: 0 };
    cur.score += Math.min(h.plays, 10) / 4;
    score.set(id, cur);
  }
  const quiet = [...score.values()].filter(
    ({ track }) => daysSinceHeard(String(track.id)) >= quietDays && !disliked.has(String(track.id)) && track.available !== false,
  );
  return spreadArtists(weightedOrder(quiet, (x) => x.score, rand).slice(0, size).map((x) => x.track));
}

/** Artists the user is into right now: weighted by plays in the last `days`. */
export function recentArtists(heard: Heard[], now: number, n = 3, days = 7) {
  const weight = new Map<string, { id: string; name: string; weight: number }>();
  for (const h of heard) {
    if (now - h.last > days * DAY) continue;
    const own = (h.track.artists || []).filter((a) => !a.various);
    for (const a of own) {
      const id = String(a.id);
      const cur = weight.get(id) ?? { id, name: a.name, weight: 0 };
      cur.weight += h.plays / own.length;
      weight.set(id, cur);
    }
  }
  return [...weight.values()].sort((a, b) => b.weight - a.weight).slice(0, n);
}

/** Tracks of similar artists: unheard, not liked, at most two per artist, artists kept apart. */
export function becauseYouListened(
  candidates: Track[],
  ctx: { liked: Set<string>; disliked: Set<string>; heard: (id: string) => boolean; exclude: Set<string> },
  size = 20,
): Track[] {
  const perArtist = new Map<string, number>();
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const t of candidates) {
    const id = String(t.id);
    if (out.length >= size) break;
    if (seen.has(id) || ctx.liked.has(id) || ctx.disliked.has(id) || ctx.heard(id) || t.available === false) continue;
    const artists = artistIds(t);
    if (artists.some((a) => ctx.exclude.has(a) || (perArtist.get(a) ?? 0) >= 2)) continue;
    seen.add(id);
    for (const a of artists) perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    out.push(t);
  }
  return spreadArtists(out);
}
