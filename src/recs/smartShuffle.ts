// Smart Shuffle (as in Spotify): shuffle a playlist and slip a fitting recommendation
// in after every few tracks. Recommendations are "similar" tracks of random tracks
// from the playlist that aren't in it and haven't played lately.

import { api } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { history, playTracks, type PlayContext } from '../player/player.ts';
import { useApp } from '../store.ts';
import { interleave, pickSuggestions } from './suggest.ts';
import { mapLimit, weightedOrder } from './util.ts';

export async function smartShuffle(tracks: Track[], title: string, from?: PlayContext) {
  const playable = tracks.filter((t) => t.available !== false);
  const shuffled = weightedOrder(playable, () => 1, Math.random);
  const seeds = shuffled.slice(0, 8);
  const similar = (await mapLimit(seeds, 4, (t) => api.similarTracks(t.id))).flat().filter(Boolean) as Track[];
  const suggestions = pickSuggestions(weightedOrder(similar, () => 1, Math.random), playable, {
    disliked: useApp.getState().disliked,
    daysSinceHeard: (id) => history.daysSince(id),
  }, Math.min(30, Math.floor(shuffled.length / 3)));
  await playTracks(interleave(shuffled, suggestions), 0, title, from, suggestions.map((t) => String(t.id)));
}
