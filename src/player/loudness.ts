// Volume levelling by Yandex's loudness data (r128: i — integrated LUFS, how loud a track
// sounds; tp — its true peak, dBTP), like Apple's Sound Check: one level for the whole track,
// nothing squeezed inside it. Tracks louder than the target are turned down to it; quieter ones
// are turned up only as far as their peak stays under PEAK_CEILING (no clipping, no limiter),
// so a quiet recording with loud peaks stays as it is.
//
// The target is about the median of today's releases (the Yandex chart: −7.6 LUFS median,
// −8.6…−6.8 for the middle half), so most tracks play at full volume and only the loudest are
// trimmed. It used to be −14 (Spotify's default), which turned nearly everything down by ~6 dB
// and made Oni sound quieter than the official app.
export const TARGET_LUFS = -8;
const MAX_CUT_DB = -12;
const MAX_BOOST_DB = 6;
/** dBTP a raised track's peak stays under (decoding a lossy file can overshoot a little). */
const PEAK_CEILING = -1;

export interface Loudness {
  i: number;
  tp: number;
}

/** Volume factor for a track (or an album) of this loudness: above 1 is raised; 1 when unknown. */
export function levellingGain(r128: Loudness | undefined) {
  if (typeof r128?.i !== 'number') return 1;
  let db = Math.max(MAX_CUT_DB, TARGET_LUFS - r128.i);
  if (db > 0) db = Math.max(0, Math.min(db, MAX_BOOST_DB, typeof r128.tp === 'number' ? PEAK_CEILING - r128.tp : 0));
  return Math.pow(10, db / 20);
}

/**
 * An album as one recording (ReplayGain's album mode): its tracks' loudness averaged as energy,
 * by their length, and its loudest peak. Played in order it keeps one level: a quiet intro
 * stays quiet next to the loud song after it, as the artist meant. Undefined when no track has it.
 */
export function albumLoudness(tracks: { r128?: Loudness; durationMs?: number }[]): Loudness | undefined {
  let energy = 0;
  let length = 0;
  let tp = -Infinity;
  for (const t of tracks) {
    if (typeof t.r128?.i !== 'number') continue;
    const d = t.durationMs || 1;
    energy += d * Math.pow(10, t.r128.i / 10);
    length += d;
    if (typeof t.r128.tp === 'number') tp = Math.max(tp, t.r128.tp);
  }
  if (!length) return undefined;
  return { i: 10 * Math.log10(energy / length), tp: tp === -Infinity ? 0 : tp };
}
