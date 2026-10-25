// The iPhone's audio element: the OniPlayer plugin (ios/App/App/OniBridge.swift) behind the part
// of HTMLAudioElement the player uses (src, play, pause, currentTime, duration, paused, ended and
// its events), so the queue, the wave and history work as on the desktop. WebKit's own element
// took the lock screen with -10 s / +10 s, and its Web Audio equalizer lagged behind seeks and
// went silent with the screen locked (checked by the user on 1.5.4).

import { registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { toBase64 } from '../api/bytes.ts';

/** How the system equalizer's bands are set up (the defaults are how Oni plays). */
export interface EqShape {
  /** One width (octaves) for every peaking band, instead of each its own. */
  bandwidth?: number;
  /** The PC rate the bands' own widths are worked out for (48000). */
  widthRate?: number;
  /** The rate the tones are rendered at (48000). */
  rate?: number;
}

interface PlayerPlugin {
  /** `sealed`: a downloaded track, opened from the library with this key (base64). `fade` (ms): with
   * music playing, it starts at once and the playing track fades out into it (a crossfade). */
  open(options: { id: string; url?: string; file?: string; sealed?: string; ext: string; keep: string[]; fade?: number; duration?: number }): Promise<{ duration: number }>;
  fetch(options: { id: string; url: string; ext: string }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(options: { time: number }): Promise<void>;
  setEq(options: { enabled: boolean; preamp: number; gains: number[] }): Promise<void>;
  setGain(options: { value: number }): Promise<void>;
  state(): Promise<{ time: number; duration: number; playing: boolean; eq: boolean; engine?: boolean; crossing?: boolean; lift?: number; streaming?: boolean; waiting?: boolean; received?: number; expected?: number }>;
  /** For the simulator run: downloads held to a slow network's pace (0: off). */
  testThrottle(options: { bytesPerSecond: number }): Promise<void>;
  /** For the simulator run: what the system equalizer set up as Oni's does at each frequency (dB). */
  eqResponse(options: { gains: number[]; preamp: number; frequencies: number[] } & EqShape): Promise<{ db: number[] }>;
  /** After a pause the engine runs on silent this long, keeping Oni awake for a remote (0: it stops at once). */
  setAwake(options: { seconds: number }): Promise<void>;
  /** Listen to the bass for the beat pulse (src/player/pulse.ts), or stop. */
  pulse(options: { on: boolean }): Promise<void>;
  /** The bass's rise, ~60 a second, sent a few at a time: when each is heard (wall clock, ms). */
  addListener(event: 'beat', cb: (e: { at: number[]; flux: number[] }) => void): Promise<unknown>;
  /** `waiting`: playing, but the track (still arriving) ran short: it goes on when more comes. */
  addListener(event: 'time', cb: (e: { time: number; duration: number; playing: boolean; waiting?: boolean; musicEnd?: number }) => void): Promise<unknown>;
  addListener(event: 'ended', cb: () => void): Promise<unknown>;
  /** A track playing while it arrived could not be fetched to its end. */
  addListener(event: 'error', cb: (e: { message: string }) => void): Promise<unknown>;
}

export const OniPlayer = registerPlugin<PlayerPlugin>('OniPlayer');

/** The file name ending AVAudioFile reads a codec by. */
export function audioExt(codec: string, upload = false) {
  // An upload's "aac" is MP4 inside (M4A): opened as bare AAC, it did not start (the user, 25.10.2026).
  if (/mp4/.test(codec) || (upload && codec === 'aac')) return 'm4a';
  if (/flac/.test(codec)) return 'flac';
  if (/aac/.test(codec)) return 'aac';
  return 'mp3';
}

/** After a play or pause from here, the plugin's clock may still report the old state a moment. */
const SETTLE_MS = 600;

export class NativeAudio extends EventTarget {
  preload = 'auto';
  crossOrigin: string | null = null;
  /** iOS's volume is the phone's (volume.ts); levelling goes through OniPlayer.setGain. */
  volume = 1;
  error: { message: string } | null = null;
  /** What the next `src` is: the track's id, its file ending, the ids whose files to keep, and
   * for a downloaded track (src `oni-sealed:<id>`) the key its file opens with. */
  next: { id: string; ext: string; keep: string[]; key?: string; duration?: number } = { id: '', ext: 'mp3', keep: [] };

  private source = '';
  private time = 0;
  private at = 0;
  private length = NaN;
  private stopped = true;
  private over = false;
  private opening: Promise<void> = Promise.resolve();
  private seq = 0;
  private commandAt = 0;
  /** A crossfade's next track is being opened: the clock and the end the player reports meanwhile
   * are the old track's, not this one's (a slow track would let the old one end, and its end
   * would skip this one). */
  private crossing = false;
  /** Where the track's music ends, the silence after it left out (the native player finds it; NaN: not yet). */
  musicEnd = NaN;
  /** The player waits for more of a track still arriving (fast start): its clock stands. */
  private short = false;

  constructor() {
    super();
    OniPlayer.addListener('time', (e) => {
      if (this.crossing) return;
      this.time = e.time;
      this.at = performance.now();
      if (Boolean(e.waiting) !== this.short) {
        this.short = Boolean(e.waiting);
        this.emit(this.short ? 'waiting' : 'playing');
      }
      this.musicEnd = e.musicEnd ?? NaN;
      if (e.duration && e.duration !== this.length) {
        this.length = e.duration;
        this.emit('durationchange');
      }
      // A call or unplugged headphones paused it natively: the page shows it.
      if (performance.now() - this.commandAt > SETTLE_MS && e.playing === this.stopped) {
        this.stopped = !e.playing;
        this.emit(e.playing ? 'playing' : 'pause');
      }
      this.emit('timeupdate');
    });
    OniPlayer.addListener('error', ({ message }) => {
      this.short = false;
      this.error = { message };
      this.emit('error');
    });
    OniPlayer.addListener('ended', () => {
      if (this.crossing) return;
      this.stopped = true;
      this.over = true;
      this.time = this.length;
      this.emit('pause');
      this.emit('ended');
    });
  }

  get src() {
    return this.source;
  }

  set src(value: string) {
    this.musicEnd = NaN;
    this.crossing = false;
    this.short = false;
    this.source = value;
    this.stopped = true;
    this.over = false;
    this.time = 0;
    this.length = NaN;
    this.error = null;
    const seq = ++this.seq;
    this.emit('emptied');
    this.emit('waiting');
    this.opening = this.open(value, seq);
    this.opening.catch(() => {});
  }

  /**
   * The crossfade (see dualAudio.ts on the desktop): `url` starts while the track playing fades
   * out into it over `ms`. Resolves when it plays; `ended` is called once the old one is silent.
   */
  async crossfade(url: string, ms: number, ended: () => void = () => {}) {
    this.musicEnd = NaN;
    this.source = url;
    this.over = false;
    this.time = 0;
    this.at = performance.now();
    this.length = NaN;
    this.error = null;
    const seq = ++this.seq;
    this.crossing = true;
    this.emit('emptied');
    this.opening = this.open(url, seq, ms);
    try {
      await this.opening;
    } finally {
      if (seq === this.seq) this.crossing = false;
    }
    if (seq !== this.seq) return;
    setTimeout(ended, ms);
    // Already playing when it crossed; if the old track ended meanwhile, this starts it. A pause
    // meanwhile is kept.
    if (!this.stopped) await this.play();
  }

  private async open(value: string, seq: number, fade = 0) {
    const { id, ext, keep, key, duration } = this.next;
    try {
      let opened: { duration: number };
      if (value.startsWith('oni-sealed:') && key) opened = await OniPlayer.open({ id, sealed: key, ext, keep, fade });
      else if (value.startsWith('blob:')) {
        // A downloaded track, decrypted by the page: written where the player reads it.
        const bytes = new Uint8Array(await (await fetch(value)).arrayBuffer());
        const file = `${id}.${ext}`;
        await Filesystem.writeFile({ path: `oni-play/${file}`, directory: Directory.Cache, data: toBase64(bytes), recursive: true });
        opened = await OniPlayer.open({ id, file, ext, keep, fade });
      } else opened = await OniPlayer.open({ id, url: value, ext, keep, fade, duration });
      if (seq !== this.seq) return;
      this.length = opened.duration;
      for (const e of ['durationchange', 'loadedmetadata', 'loadeddata', 'canplay']) this.emit(e);
    } catch (e) {
      if (seq !== this.seq) return;
      this.error = { message: String(e) };
      this.emit('error');
      throw e;
    }
  }

  get currentTime() {
    if (this.stopped || this.short) return this.time;
    return Math.min(this.time + (performance.now() - this.at) / 1000, Number.isFinite(this.length) ? this.length : Infinity);
  }

  set currentTime(value: number) {
    this.time = value;
    this.at = performance.now();
    this.over = false;
    this.emit('seeking');
    this.opening
      .then(() => OniPlayer.seek({ time: value }))
      .then(() => this.emit('seeked'))
      .catch(() => {});
  }

  get duration() {
    return this.length;
  }

  get paused() {
    return this.stopped;
  }

  get ended() {
    return this.over;
  }

  async play() {
    await this.opening;
    this.commandAt = performance.now();
    this.stopped = false;
    this.over = false;
    this.at = performance.now();
    this.emit('play');
    await OniPlayer.play();
    this.emit('playing');
  }

  pause() {
    if (this.stopped) return;
    this.commandAt = performance.now();
    this.time = this.currentTime;
    this.stopped = true;
    this.emit('pause');
    OniPlayer.pause().catch(() => {});
  }

  private emit(type: string) {
    this.dispatchEvent(new Event(type));
  }
}
