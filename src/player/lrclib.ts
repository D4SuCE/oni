// LRCLIB's answers (player/lyrics.ts): which of the songs found is the track playing. Apart, so the
// offline tests can try it.

export interface Lyrics {
  synced: boolean;
  text: string;
  source: 'yandex' | 'lrclib';
}

/** LRCLIB's duration may differ a little from Yandex's (another master, silence at the end). */
const SLACK = 3;

export interface LrclibHit {
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

/** The hit of the track's length (a cover, a remix, a live take is longer or shorter): synced first. */
export function pickLrclib(hits: LrclibHit[], seconds: number): Lyrics | null {
  const fits = hits.filter((h) => !h.instrumental && (h.syncedLyrics?.trim() || h.plainLyrics?.trim()) && (!seconds || Math.abs((h.duration ?? 0) - seconds) <= SLACK));
  const best = fits.find((h) => h.syncedLyrics?.trim()) ?? fits[0];
  if (!best) return null;
  const synced = Boolean(best.syncedLyrics?.trim());
  return { synced, text: (synced ? best.syncedLyrics : best.plainLyrics)!.trim(), source: 'lrclib' };
}
