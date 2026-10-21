// Volume levelling by Yandex's loudness data (r128.i, integrated LUFS): tracks louder than
// the target are turned down to it, quieter ones are left alone (an <audio> element can't go
// above full volume).
//
// The target is about the median of today's releases (the Yandex chart: −7.6 LUFS median,
// −8.6…−6.8 for the middle half), so most tracks play at full volume and only the loudest are
// trimmed. It used to be −14 (Spotify's default), which turned nearly everything down by ~6 dB
// and made Oni sound quieter than the official app.
export const TARGET_LUFS = -8;
const MAX_CUT_DB = -12;

/** Volume factor 0…1 for a track of `lufs` integrated loudness; 1 when unknown. */
export function levellingGain(lufs: number | undefined) {
  if (typeof lufs !== 'number') return 1;
  const db = Math.min(0, Math.max(MAX_CUT_DB, TARGET_LUFS - lufs));
  return Math.pow(10, db / 20);
}
