// Private listening (as Spotify's private session; from other clients — docs/other-clients.md):
// while it is on, what plays is not told to Yandex (its history, My Wave's learning), counts for none
// of Oni's own picks (Recap, smart playlists, "Skipped"), and Discord shows nothing. Oni's History
// keeps it only if asked. Likes and dislikes stay: they are said on purpose. It stays on until turned
// off (shown on the player bar, not to be forgotten on).

import { create } from 'zustand';
import { loadJson, storage } from '../api/client.ts';

const KEY = 'player.private';

export interface Privacy {
  on: boolean;
  /** Oni's own History (the list of what played) still takes what plays. */
  keepHistory: boolean;
}

export const usePrivacy = create<Privacy>(() => ({ on: false, keepHistory: false, ...loadJson<Partial<Privacy>>(KEY, {}) }));

export function setPrivacy(next: Partial<Privacy>) {
  usePrivacy.setState(next);
  const { on, keepHistory } = usePrivacy.getState();
  storage.setItem(KEY, JSON.stringify({ on, keepHistory }));
}

/** Plays are not told to Yandex nor counted for Oni's picks now. */
export const isPrivate = () => usePrivacy.getState().on;
