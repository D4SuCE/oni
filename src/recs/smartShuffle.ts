// Smart Shuffle (as in Spotify): shuffle a playlist and slip a fitting recommendation
// in after every few tracks. Recommendations are "similar" tracks of random tracks
// from the playlist that aren't in it and haven't played lately.

import { create } from 'zustand';
import { api, storage } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { history, playTracks, type PlayContext } from '../player/player.ts';
import { useApp } from '../store.ts';
import { interleave, pickSuggestions } from './suggest.ts';
import { mapLimit, weightedOrder } from './util.ts';

/** After how many of the list's own tracks a recommendation comes (Settings > Playback; the user,
 * 26.10.2026: "1, 2, 3 and so on, a slider"). Three, as before, unless set. */
export const SMART_EVERY = { min: 1, max: 6, initial: 3 };
const EVERY_KEY = 'recs.smartEvery';

function storedEvery() {
  const n = Number(storage.getItem(EVERY_KEY));
  return Number.isInteger(n) && n >= SMART_EVERY.min && n <= SMART_EVERY.max ? n : SMART_EVERY.initial;
}

export const useSmartEvery = create<{ every: number }>(() => ({ every: storedEvery() }));

export function setSmartEvery(every: number) {
  const n = Math.max(SMART_EVERY.min, Math.min(SMART_EVERY.max, Math.round(every)));
  useSmartEvery.setState({ every: n });
  storage.setItem(EVERY_KEY, String(n));
}

export async function smartShuffle(tracks: Track[], title: string, from?: PlayContext) {
  const every = useSmartEvery.getState().every;
  const playable = tracks.filter((t) => t.available !== false);
  const shuffled = weightedOrder(playable, () => 1, Math.random);
  const seeds = shuffled.slice(0, 8);
  const similar = (await mapLimit(seeds, 4, (t) => api.similarTracks(t.id))).flat().filter(Boolean) as Track[];
  const suggestions = pickSuggestions(weightedOrder(similar, () => 1, Math.random), playable, {
    disliked: useApp.getState().disliked,
    daysSinceHeard: (id) => history.daysSince(id),
  }, Math.min(30, Math.floor(shuffled.length / every)));
  await playTracks(interleave(shuffled, suggestions, every), 0, title, from, { suggested: suggestions.map((t) => String(t.id)) });
}
