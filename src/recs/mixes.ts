// "Mixes for you", the Daily Mix idea: the taste profile is split into clusters
// and each mix is mostly familiar tracks from one cluster plus some new ones near it.
//
// Clusters are genres rather than artists: in real libraries most artists have a
// single liked track, so artist graphs fall apart, while Yandex tags every album
// with a genre. A sub-genre big enough to be a taste of its own (J-pop inside pop,
// say) gets its own mix.

import type { Track } from '../api/types.ts';
import type { GenreTree, Profile, WeightedTrack } from './profile.ts';
import { artistIds, spreadArtists, trackGenre, weightedOrder } from './util.ts';

export interface MixPlan {
  /** Genre id the cluster is built around (top-level or a large sub-genre). */
  genre: string;
  tracks: WeightedTrack[];
  weight: number;
  /** Most present artists, for the mix title. */
  artists: string[];
}

export interface MixOptions {
  maxMixes?: number;
  minTracks?: number;
  /** A sub-genre becomes its own cluster at this many tracks… */
  subGenreMin?: number;
  /** …and this share of its parent genre. */
  subGenreShare?: number;
}

export function planMixes(profile: Profile, tree: GenreTree, opts: MixOptions = {}): MixPlan[] {
  const { maxMixes = 6, minTracks = 10, subGenreMin = 15, subGenreShare = 0.15 } = opts;
  const tracks = [...profile.tracks.values()].filter((t) => trackGenre(t.track));
  const count = (key: (t: WeightedTrack) => string) => {
    const m = new Map<string, number>();
    for (const t of tracks) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
    return m;
  };
  const top = (g: string) => tree.parent[g] ?? g;
  const byGenre = count((t) => trackGenre(t.track)!);
  const byTop = count((t) => top(trackGenre(t.track)!));
  const ownCluster = (g: string) => g !== top(g) && (byGenre.get(g) ?? 0) >= subGenreMin && (byGenre.get(g) ?? 0) >= subGenreShare * (byTop.get(top(g)) ?? 0);

  const clusters = new Map<string, WeightedTrack[]>();
  for (const t of tracks) {
    const g = trackGenre(t.track)!;
    const key = ownCluster(g) ? g : top(g);
    clusters.set(key, [...(clusters.get(key) ?? []), t]);
  }

  return [...clusters.entries()]
    .filter(([, ts]) => ts.length >= minTracks)
    .map(([genre, ts]) => {
      const artistWeight = new Map<string, number>();
      for (const t of ts) for (const a of t.track.artists || []) if (!a.various) artistWeight.set(a.name, (artistWeight.get(a.name) ?? 0) + t.weight);
      return {
        genre,
        tracks: ts.sort((a, b) => b.weight - a.weight),
        weight: ts.reduce((s, t) => s + t.weight, 0),
        artists: [...artistWeight.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxMixes);
}

/** Tracks to ask "similar" for: weighted picks from the top of the cluster, different each day. */
export function mixSeeds(plan: MixPlan, n: number, rand: () => number): Track[] {
  return weightedOrder(plan.tracks.slice(0, n * 4), (t) => t.weight, rand)
    .slice(0, n)
    .map((t) => t.track);
}

export interface AssembleContext {
  tree: GenreTree;
  liked: Set<string>;
  disliked: Set<string>;
  /** Days since the track was last heard here, Infinity if never. */
  daysSinceHeard: (id: string) => number;
  rand: () => number;
}

export function assembleMix(plan: MixPlan, candidates: Track[], ctx: AssembleContext, size = 50, familiarShare = 0.7): Track[] {
  const top = (g?: string) => (g ? (ctx.tree.parent[g] ?? g) : undefined);
  const clusterTop = top(plan.genre);
  const inCluster = new Set(plan.tracks.map((t) => String(t.track.id)));

  // Familiar: the cluster itself, weighted, skipping what played in the last day.
  const familiar = weightedOrder(
    plan.tracks.filter((t) => ctx.daysSinceHeard(String(t.track.id)) >= 1),
    (t) => t.weight,
    ctx.rand,
  ).map((t) => t.track);

  // New: similar tracks that stay in the cluster's genre, have not been heard
  // recently, and give each artist at most two slots.
  const perArtist = new Map<string, number>();
  const seen = new Set<string>();
  const fresh: Track[] = [];
  for (const t of weightedOrder(candidates, () => 1, ctx.rand)) {
    const id = String(t.id);
    if (seen.has(id) || inCluster.has(id) || ctx.liked.has(id) || ctx.disliked.has(id) || t.available === false) continue;
    seen.add(id);
    const g = trackGenre(t);
    if (g && top(g) !== clusterTop && g !== plan.genre) continue;
    if (ctx.daysSinceHeard(id) < 30) continue;
    const artists = artistIds(t);
    if (artists.some((a) => (perArtist.get(a) ?? 0) >= 2)) continue;
    for (const a of artists) perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    fresh.push(t);
  }

  const newCount = Math.min(fresh.length, Math.round(size * (1 - familiarShare)));
  const famCount = Math.min(familiar.length, size - newCount);
  const fam = familiar.slice(0, famCount);
  const neu = fresh.slice(0, newCount);

  // Interleave roughly two familiar to one new, then keep artists apart.
  const out: Track[] = [];
  let f = 0;
  let n = 0;
  while (f < fam.length || n < neu.length) {
    if (f < fam.length) out.push(fam[f++]);
    if (f < fam.length) out.push(fam[f++]);
    if (n < neu.length) out.push(neu[n++]);
  }
  return spreadArtists(out);
}
