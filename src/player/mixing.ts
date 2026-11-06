// What the DJ-like transition (automix.ts) knows of the tracks around it: where their singing is
// (the lyrics, both platforms), and on the desktop the last 40 s of the track playing and the first
// 40 s of the next one, decoded from their own bytes (an MP3's piece decodes alone, exactly where the
// whole file's is — measured 6.11.2026): their beat grids, where this one's music ends and where the
// next one's starts. All of it is asked for once a track and kept for the few around.

import type { Track } from '../api/types.ts';
import { beatGrid, type Grid } from './beatGrid.ts';
import { voiceOf, type Voice } from './automix.ts';
import { lastAudible, leadFrom } from './silence.ts';

export interface Known {
  /** Undefined until the lyrics have been asked (and when they say nothing of it). */
  voice?: Voice;
  voiceAsked?: boolean;
  /** The last SECONDS: the grid in the track's own time, and where its music ends. */
  tail?: { grid: Grid | null; end: number } | null;
  /** The first SECONDS: the grid, and where its sound starts. */
  head?: { grid: Grid | null; lead: number } | null;
}

const SECONDS = 40;
const RATE = 11025;
/** Kept for this many tracks. */
const KEEP = 8;

const known = new Map<string, Known>();
const asked = new Set<string>();

export function knownOf(id: string | number): Known {
  const key = String(id);
  let k = known.get(key);
  if (!k) {
    known.set(key, (k = {}));
    while (known.size > KEEP) known.delete(known.keys().next().value!);
  }
  return k;
}

/** The track's singing, from its lyrics (asked once). */
export function askVoice(t: Track) {
  const k = knownOf(t.id);
  if (k.voiceAsked) return;
  k.voiceAsked = true;
  import('./lyrics.ts')
    .then((m) => m.lyricsOf(t))
    .then((l) => (k.voice = voiceOf(l, (t.durationMs || 0) / 1000)))
    .catch(() => (k.voiceAsked = false));
}

/** `bytes` decoded to one channel at RATE (null: the format cannot be decoded from a piece). */
async function decode(bytes: ArrayBuffer): Promise<Float32Array | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const d = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes);
    const a = d.getChannelData(0);
    if (d.numberOfChannels < 2) return a;
    const b = d.getChannelData(1);
    const out = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
    return out;
  } catch {
    return null;
  }
}

/** A piece of the file: its first `n` bytes, or its last (`tail`). A local copy (blob:) is read whole. */
async function piece(url: string, n: number, tail: boolean): Promise<ArrayBuffer | null> {
  if (url.startsWith('blob:')) {
    const all = await (await fetch(url)).arrayBuffer();
    return tail ? all.slice(Math.max(0, all.byteLength - n)) : all.slice(0, n);
  }
  if (!/^https?:/.test(url)) return null;
  const r = await fetch(url, { headers: { Range: tail ? `bytes=-${n}` : `bytes=0-${n - 1}` } });
  if (!r.ok) return null;
  const all = await r.arrayBuffer();
  // A server that ignores the range sends the whole file.
  if (r.status === 200) return tail ? all.slice(Math.max(0, all.byteLength - n)) : all.slice(0, n);
  return all;
}

/** How many bytes SECONDS of it take (kbps; 0 unknown: as 320). */
const bytesFor = (bitrate: number) => Math.round(SECONDS * (bitrate || 320) * 125);

/** Formats a piece of decodes alone (a frame-by-frame stream; FLAC and MP4 need their start). */
const piecewise = (codec: string) => /^(mp3|aac|he-aac)$/i.test(codec);

/**
 * The desktop: the track's last SECONDS, its grid and its music's end. `duration`: the audio
 * element's (the decoded piece ends where the file does).
 */
export function askTail(id: string | number, url: string, codec: string, bitrate: number, duration: number) {
  const key = `tail:${id}`;
  if (asked.has(key) || !Number.isFinite(duration) || duration < SECONDS * 2) return;
  asked.add(key);
  const k = knownOf(id);
  if (!piecewise(codec) && !url.startsWith('blob:')) return void (k.tail = null);
  piece(url, bytesFor(bitrate), true)
    .then((b) => (b ? decode(b) : null))
    .then((pcm) => {
      if (!pcm) return void (k.tail = null);
      const offset = duration - pcm.length / RATE;
      const g = beatGrid(pcm, RATE);
      const grid = g && { ...g, anchor: g.anchor + offset, beats: g.beats.map((b) => b + offset) };
      k.tail = { grid, end: offset + lastAudible([pcm], RATE) };
    })
    .catch(() => {
      asked.delete(key);
    });
}

/** The desktop: the next track's first SECONDS, its grid and where its sound starts. */
export function askHead(id: string | number, url: string, codec: string, bitrate: number): Promise<void> {
  const key = `head:${id}`;
  if (asked.has(key)) return Promise.resolve();
  asked.add(key);
  const k = knownOf(id);
  if (!piecewise(codec) && !url.startsWith('blob:')) {
    k.head = null;
    return Promise.resolve();
  }
  return piece(url, bytesFor(bitrate), false)
    .then((b) => (b ? decode(b) : null))
    .then((pcm) => {
      k.head = pcm ? { grid: beatGrid(pcm, RATE), lead: leadFrom([pcm], RATE) } : null;
    })
    .catch(() => {
      asked.delete(key);
    });
}
