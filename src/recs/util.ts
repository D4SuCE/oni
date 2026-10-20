// Small helpers shared by the recommendation modules.

import type { Track } from '../api/types.ts';

export const DAY = 86_400_000;

/** Deterministic PRNG, so a mix stays the same for the whole day or week it belongs to. */
export function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted shuffle (Efraimidis–Spirakis): heavier items tend to come first, but not always. */
export function weightedOrder<T>(items: T[], weight: (x: T) => number, rand: () => number): T[] {
  return items
    .map((x) => ({ x, key: Math.pow(rand() || 1e-9, 1 / Math.max(weight(x), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .map((e) => e.x);
}

export const artistIds = (t: Track) => (t.artists || []).filter((a) => !a.various).map((a) => String(a.id));

export const trackGenre = (t: Track) => t.albums?.[0]?.genre;

/** Reorders so the same artist doesn't come up within `gap` tracks, when that is possible at all. */
export function spreadArtists(tracks: Track[], gap = 3): Track[] {
  const rest = [...tracks];
  const out: Track[] = [];
  while (rest.length) {
    const recent = new Set(out.slice(-gap).flatMap(artistIds));
    const i = rest.findIndex((t) => !artistIds(t).some((a) => recent.has(a)));
    out.push(...rest.splice(i === -1 ? 0 : i, 1));
  }
  return out;
}

/** Runs fn over items with at most `limit` calls in flight; failed calls yield undefined. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = undefined;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Local calendar day and ISO-like week keys, used to decide when a mix is due for a refresh. */
export function dayKey(now: number) {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Key of the week that started on the most recent `weekday` (0 = Sunday, 1 = Monday, 5 = Friday). */
export function weekKey(now: number, weekday: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7));
  return dayKey(d.getTime());
}
