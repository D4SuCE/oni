// A big playlist's tracks, a part at a time (the user: a friend's 1,600-track list took seconds to
// open). The playlist comes as ids only (~200 KB instead of ~4.5 MB with every track in it); the
// first hundred tracks follow at once and the rest in parts in the background, in the list's
// order, so they are there by the time the list is scrolled down to them.

import { useEffect, useMemo, useState } from 'react';
import type { Playlist, Track } from '../api/types.ts';
import { api } from '../api/client.ts';

const FIRST = 100;
const PART = 200;

/** A playlist as the page has it: with tracks in it (small, or kept for the offline mode) or ids only. */
const keyOf = (item: NonNullable<Playlist['tracks']>[number]) => (item.albumId ? `${item.id}:${item.albumId}` : String(item.id));

export interface ListTracks {
  tracks: Track[];
  /** How many the list has. */
  total: number;
  complete: boolean;
}

export function useListTracks(pl: Playlist | null | undefined): ListTracks {
  // Tracks in it already (small, or kept for the offline mode): nothing to load.
  const whole = useMemo<ListTracks | null>(() => {
    const items = pl?.tracks || [];
    return items.every((x) => x.track) ? { tracks: items.map((x) => x.track!), total: items.length, complete: Boolean(pl) } : null;
  }, [pl]);
  // The parts in so far, for the playlist they belong to.
  const [loaded, setLoaded] = useState<{ pl: Playlist; tracks: Track[]; complete: boolean } | null>(null);
  useEffect(() => {
    if (!pl || whole) return;
    const items = pl.tracks || [];
    const keys = items.map(keyOf);
    let alive = true;
    (async () => {
      let have: Track[] = [];
      for (let from = 0; from < keys.length && alive; ) {
        const size = from === 0 ? FIRST : PART;
        const part = await api.tracks(keys.slice(from, from + size)).catch(() => null);
        if (!alive) return;
        // A part that failed (a moment without network): the list stops where it got to.
        if (!part) break;
        // In the list's order whatever order they came back in.
        const byId = new Map(part.map((t) => [String(t.id), t]));
        have = [...have, ...items.slice(from, from + size).map((x) => byId.get(String(x.id))).filter((t): t is Track => Boolean(t))];
        from += size;
        setLoaded({ pl, tracks: have, complete: from >= keys.length });
      }
    })();
    return () => {
      alive = false;
    };
  }, [pl, whole]);
  if (whole) return whole;
  const total = pl?.tracks?.length ?? 0;
  return loaded && loaded.pl === pl ? { tracks: loaded.tracks, total, complete: loaded.complete } : { tracks: EMPTY, total, complete: false };
}

const EMPTY: Track[] = [];
