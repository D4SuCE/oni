// "Weekly discoveries", the Discover Weekly idea: tracks the user has never heard,
// found by letting the user's favourite tracks vote through Yandex's "similar"
// lists (its similarity is itself collaborative: built from what people play together).

import type { Track } from '../api/types.ts';
import type { GenreTree, Profile } from './profile.ts';
import { artistIds, spreadArtists, trackGenre, weightedOrder } from './util.ts';

/** Favourite tracks to start from: strong and recent ones, a different draw every week. */
export function discoverSeeds(profile: Profile, n: number, rand: () => number): Track[] {
  const ranked = [...profile.tracks.values()].sort((a, b) => b.weight - a.weight).slice(0, n * 3);
  return weightedOrder(ranked, (t) => t.weight, rand)
    .slice(0, n)
    .map((t) => t.track);
}

export interface DiscoverContext {
  tree: GenreTree;
  liked: Set<string>;
  disliked: Set<string>;
  /** Heard at all, in this app or on another device. */
  heard: (id: string) => boolean;
  /** Artists the user already has in the profile; new artists rank higher. */
  knownArtists: Set<string>;
}

export function rankDiscoveries(results: { seed: Track; similar: Track[] }[], ctx: DiscoverContext, size = 30, maxGenreShare = 0.4): Track[] {
  const scores = new Map<string, { track: Track; score: number }>();
  for (const { similar } of results) {
    similar.forEach((t, pos) => {
      const id = String(t.id);
      if (ctx.liked.has(id) || ctx.disliked.has(id) || ctx.heard(id) || t.available === false) return;
      // Several seeds pointing at the same track is the strongest signal; earlier places count a bit more.
      const vote = 1 + 0.5 * (1 - pos / Math.max(similar.length, 1));
      const cur = scores.get(id);
      if (cur) cur.score += vote;
      else scores.set(id, { track: t, score: vote });
    });
  }
  for (const s of scores.values()) if (!artistIds(s.track).some((a) => ctx.knownArtists.has(a))) s.score *= 1.5;

  const usedArtists = new Set<string>();
  const perGenre = new Map<string, number>();
  const genreCap = Math.max(1, Math.ceil(size * maxGenreShare));
  const out: Track[] = [];
  for (const { track } of [...scores.values()].sort((a, b) => b.score - a.score)) {
    if (out.length >= size) break;
    const artists = artistIds(track);
    if (artists.some((a) => usedArtists.has(a))) continue;
    const g = trackGenre(track);
    const top = g ? (ctx.tree.parent[g] ?? g) : '';
    if (top && (perGenre.get(top) ?? 0) >= genreCap) continue;
    for (const a of artists) usedArtists.add(a);
    if (top) perGenre.set(top, (perGenre.get(top) ?? 0) + 1);
    out.push(track);
  }
  return spreadArtists(out);
}
