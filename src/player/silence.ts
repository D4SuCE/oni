// The smart crossfade (the user's pick, 24.10.2026): the next track comes in where this one's music
// really ends, not where its file does, and from its first sound, not from silence before it. The
// iPhone's player finds both in the file itself (OniBridge.swift, `audible`); the desktop hears this
// track's end as it plays (the level after the elements, eq.ts) and looks at the next one's first
// seconds before it starts.

/** Quieter than this is silence: -50 dBFS (a fade-out has gone, a rest in the music has not). */
const SILENT = 10 ** (-50 / 20);
/** Silence at a track's start shorter than this is left as it is (an attack's breath, not a gap). */
const MIN_LEAD = 0.25;
/** A track's start is looked at this far at most. */
const MAX_LEAD = 8;

/** Seconds into the samples where the first sound is (none: their whole length). */
export function firstAudible(channels: Float32Array[], rate: number): number {
  const n = channels[0]?.length ?? 0;
  for (let i = 0; i < n; i++) for (const c of channels) if (Math.abs(c[i]) > SILENT) return i / rate;
  return n / rate;
}

/** Seconds into the samples just after the last sound (0: none). */
export function lastAudible(channels: Float32Array[], rate: number): number {
  for (let i = (channels[0]?.length ?? 0) - 1; i >= 0; i--) for (const c of channels) if (Math.abs(c[i]) > SILENT) return (i + 1) / rate;
  return 0;
}

/** Where to start a track in a crossfade: past its silence at the start, when there is enough of it. */
export function leadFrom(channels: Float32Array[], rate: number): number {
  const lead = firstAudible(channels, rate);
  return lead >= MIN_LEAD && lead < MAX_LEAD ? lead : 0;
}

/**
 * The desktop: the next track's silence at its start, from its first bytes (a stream's or a
 * download's), decoded. 0 when it cannot tell in time (a format that needs the whole file, a slow
 * network): the crossfade then starts it from the beginning, as before.
 */
export async function leadingSilence(url: string, timeout = 1500): Promise<number> {
  if (!/^(https?|blob):/.test(url) || typeof OfflineAudioContext === 'undefined') return 0;
  const look = (async () => {
    const r = await fetch(url, url.startsWith('blob:') ? {} : { headers: { Range: 'bytes=0-399999' } });
    const bytes = await r.arrayBuffer();
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i).subarray(0, Math.ceil(MAX_LEAD * decoded.sampleRate)));
    return leadFrom(channels, decoded.sampleRate);
  })().catch(() => 0);
  return Promise.race([look, new Promise<number>((done) => setTimeout(() => done(0), timeout))]);
}

/**
 * The desktop hears this track's end: quiet (below SILENT for the volume asked) for `hold` seconds
 * in its last stretch means its music is over. Fed on every clock tick; true once it has been.
 */
export class QuietTail {
  private since: number | null = null;
  private hold: number;

  constructor(hold = 1.5) {
    this.hold = hold;
  }

  /** `level`: the output's RMS now; `volume`: the volume it was played at. */
  feed(t: number, level: number, volume: number): boolean {
    if (volume < 0.02) return false; // turned down to nothing: nothing to hear
    if (level / volume > SILENT) {
      this.since = null;
      return false;
    }
    this.since ??= t;
    return t - this.since >= this.hold;
  }

  reset() {
    this.since = null;
  }
}
