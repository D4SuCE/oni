// Pure parts of Smart Shuffle (tested offline in tests/recs.test.ts).

import type { Track } from '../api/types.ts';
import { artistIds } from './util.ts';

/** Every `every` tracks, one recommendation; leftovers are dropped. */
export function interleave(tracks: Track[], recs: Track[], every = 3): Track[] {
  const out: Track[] = [];
  let r = 0;
  tracks.forEach((t, i) => {
    out.push(t);
    if ((i + 1) % every === 0 && r < recs.length) out.push(recs[r++]);
  });
  return out;
}

/** Candidates not in the list, not disliked, not heard in the last `quietDays`, one per artist. */
export function pickSuggestions(
  candidates: Track[],
  list: Track[],
  ctx: { disliked: Set<string>; daysSinceHeard: (id: string) => number },
  count: number,
  quietDays = 14,
): Track[] {
  const inList = new Set(list.map((t) => String(t.id)));
  const usedArtists = new Set<string>();
  const out: Track[] = [];
  for (const t of candidates) {
    if (out.length >= count) break;
    const id = String(t.id);
    if (inList.has(id) || ctx.disliked.has(id) || t.available === false || ctx.daysSinceHeard(id) < quietDays) continue;
    const artists = artistIds(t);
    if (artists.some((a) => usedArtists.has(a))) continue;
    inList.add(id);
    for (const a of artists) usedArtists.add(a);
    out.push(t);
  }
  return out;
}
