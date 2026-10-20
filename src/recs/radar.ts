// "Release radar": what the user's artists put out in the last few weeks.

import type { Album, Track } from '../api/types.ts';
import type { Profile } from './profile.ts';
import { DAY, spreadArtists } from './util.ts';

/**
 * The artists to watch, at most n (each costs a request): half the slots for artists the
 * user follows (liked), the rest — and any left over — for the strongest in the profile.
 */
export function radarArtists(profile: Profile, followed: { id: number | string; name: string }[], n = 40) {
  const ids = new Map<string, string>();
  for (const a of followed.slice(0, Math.ceil(n / 2))) ids.set(String(a.id), a.name);
  const ranked = [...profile.artists.entries()].sort((a, b) => b[1].weight - a[1].weight);
  for (const [id, a] of ranked) {
    if (ids.size >= n) break;
    ids.set(id, a.name);
  }
  for (const a of followed) {
    if (ids.size >= n) break;
    ids.set(String(a.id), a.name);
  }
  return [...ids.entries()].map(([id, name]) => ({ id, name }));
}

/** Releases newer than `days`, newest first, each album once. */
export function recentReleases(albums: Album[], now: number, days = 28): Album[] {
  const seen = new Set<number>();
  return albums
    .filter((a) => {
      if (!a.releaseDate || seen.has(a.id)) return false;
      seen.add(a.id);
      const age = now - Date.parse(a.releaseDate);
      return age >= 0 && age <= days * DAY;
    })
    .sort((a, b) => Date.parse(b.releaseDate!) - Date.parse(a.releaseDate!));
}

/** A couple of tracks from each release (the first ones, usually the focus tracks), newest release first. */
export function radarTracks(releases: { album: Album; tracks: Track[] }[], disliked: Set<string>, perRelease = 2, size = 40): Track[] {
  const out: Track[] = [];
  const seen = new Set<string>();
  for (const { tracks } of releases) {
    let taken = 0;
    for (const t of tracks) {
      const id = String(t.id);
      if (taken >= perRelease || out.length >= size) break;
      if (seen.has(id) || disliked.has(id) || t.available === false) continue;
      seen.add(id);
      out.push(t);
      taken++;
    }
  }
  return spreadArtists(out, 2);
}
