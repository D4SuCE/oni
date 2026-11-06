// The desktop's audio element for crossfades (the user's wish: one track flowing into the next).
// Two real <audio> elements behind the surface of one: the player and everything else talk to
// the one playing now; `crossfade` starts the next track on the other, fades it in while this one
// fades out, and from then on the other is the one. Events come from the playing one only (the
// fading one's "ended" is nobody's business). The equalizer takes both (`elements`).

/** A crossing by the beat (automix.ts): the new track at `rate` (this one's tempo), its time `to` laid
 * on the old one's `on`; silent for `quiet` s while it is put on the beat. */
export interface BeatSync {
  rate: number;
  on: number;
  to: number;
  quiet: number;
}

/** Off the beat by more than this while still silent: put right by a jump (s), again and again (a
 * jump lands a little off itself), one a JUMP_MS at most. */
const JUMP = 0.004;
const JUMP_MS = 200;
/** Heard, it is put right by its speed: off by more than DEADBAND, a speed that makes it up in about
 * a second (at most MAX_NUDGE off), looked at again after NUDGE_MS. A speed changed every frame
 * made the element stumble (its time jumped 20–25 ms every couple of seconds, 6.11.2026). */
const DEADBAND = 0.005;
const MAX_NUDGE = 0.02;
const NUDGE_MS = 600;
/** After the crossing the new track eases back to the speed asked over this long (ms), in steps
 * (each change of speed is a small stumble) of at most GLIDE_STEP, one a GLIDE_EVERY. */
const GLIDE_MS = 6000;
const GLIDE_STEP = 0.005;
const GLIDE_EVERY = 500;

/** Events the app listens to on its audio element. */
const EVENTS = ['play', 'playing', 'pause', 'waiting', 'canplay', 'loadedmetadata', 'durationchange', 'timeupdate', 'ended', 'error', 'seeking', 'seeked', 'emptied'];

export class DualAudio extends EventTarget {
  readonly elements: [HTMLAudioElement, HTMLAudioElement];
  private active = 0;
  private ready: string | null = null;
  /** The volume asked for; a fade scales it per element. */
  private level = 1;
  /** `ms`: the old one's fade out; `inMs`: the new one's fade in; `fromLevel`: the old one's own
   * volume, kept while it fades (the volume asked for from then on is the new track's). */
  private fade: { from: HTMLAudioElement; to: HTMLAudioElement; start: number; ms: number; inMs: number; outDelay: number; fromLevel: number; frame: number; done: () => void; sync?: BeatSync; jumped: number; nudged: number; lastJump?: boolean; offs: number[] } | null = null;
  /** The speed asked for (both elements, outside a crossing by the beat). */
  private rate = 1;
  /** The new track easing back to `rate` after a crossing by the beat. */
  private glide: { el: HTMLAudioElement; from: number; start: number; frame: number } | null = null;
  /** How far off the beat the last crossing by the beat was, measured once heard (s; the tests read it). */
  syncError: number[] = [];
  /** A jump in a playing element lands this late (s): it plays on from the new place only after a
   * moment, so it is aimed that far ahead. Learnt from the jumps themselves. */
  private seekLead = 0.03;

  constructor() {
    super();
    this.elements = [new Audio(), new Audio()];
    for (const el of this.elements) {
      el.preload = 'auto';
      for (const type of EVENTS) el.addEventListener(type, () => el === this.el && this.dispatchEvent(new Event(type)));
    }
  }

  /**
   * The next track's address on the other element, silent, so its start is there when it is wanted
   * (a track used to start from nothing at the moment the last one ended). Nothing of it is heard or
   * told until `src` or `crossfade` is given the same address.
   */
  prepare(url: string) {
    if (this.fade) return;
    const to = this.other;
    to.volume = 0;
    this.ready = url;
    to.src = url;
  }

  /** The address `prepare` was last given (for the tests, too). */
  get prepared() {
    return this.ready;
  }

  /** The element playing now. */
  get el() {
    return this.elements[this.active];
  }

  private get other() {
    return this.elements[1 - this.active];
  }

  /** A fade still running: done now (the old track stops, the new one at full volume). */
  private endFade() {
    const f = this.fade;
    if (!f) return;
    this.fade = null;
    cancelAnimationFrame(f.frame);
    f.from.pause();
    f.from.volume = 0;
    f.from.playbackRate = this.rate;
    f.to.volume = this.level;
    if (f.sync) this.startGlide(f.to);
    f.done();
  }

  /** The new track of a crossing by the beat back to the speed asked, slowly (a tempo change heard as none). */
  private startGlide(el: HTMLAudioElement) {
    this.stopGlide();
    const from = el.playbackRate;
    const steps = Math.ceil(Math.abs(from - this.rate) / GLIDE_STEP);
    if (steps <= 1) {
      el.playbackRate = this.rate;
      return;
    }
    const g = { el, from, start: performance.now(), frame: 0 };
    let done = 0;
    const step = () => {
      if (this.glide !== g) return;
      done++;
      el.playbackRate = done >= steps ? this.rate : from + ((this.rate - from) * done) / steps;
      if (done >= steps) this.glide = null;
      else g.frame = window.setTimeout(step, Math.max(GLIDE_EVERY, GLIDE_MS / steps));
    };
    this.glide = g;
    g.frame = window.setTimeout(step, GLIDE_EVERY);
  }

  private stopGlide() {
    if (!this.glide) return;
    clearTimeout(this.glide.frame);
    this.glide.el.playbackRate = this.rate;
    this.glide = null;
  }

  /**
   * Starts `url` on the other element and crosses over to it in `ms`. Resolves when it plays;
   * `ended` is called once the old one is silent (for freeing what it played). `inMs`: the new
   * one comes in this fast (the old one already quiet: nothing to blend with, see player.ts);
   * `fromLevel`: the old one's volume as it fades (its own level, not the new track's).
   */
  async crossfade(url: string, ms: number, ended: () => void = () => {}, startAt = 0, { inMs = ms, fromLevel, sync, outDelay = 0 }: { inMs?: number; fromLevel?: number; sync?: BeatSync; outDelay?: number } = {}) {
    this.endFade();
    this.stopGlide();
    const from = this.el;
    const fromAt = Math.max(0, Math.min(1, fromLevel ?? from.volume));
    const to = this.other;
    if (this.ready !== url || to.error) to.src = url;
    this.ready = null;
    // Past its silence at the start (the smart crossfade, silence.ts).
    if (startAt > 0) to.currentTime = startAt;
    to.volume = 0;
    to.playbackRate = sync ? sync.rate : this.rate;
    if (sync) to.preservesPitch = true;
    this.syncError = [];
    this.active = 1 - this.active;
    this.dispatchEvent(new Event('emptied'));
    try {
      await to.play();
    } catch (e) {
      // It could not start: the old one plays on, as before.
      this.active = 1 - this.active;
      throw e;
    }
    const step = () => {
      const f = this.fade;
      if (!f) return;
      if (f.sync) this.keepOnBeat(f);
      const passed = performance.now() - f.start;
      if (passed < 0) {
        f.frame = requestAnimationFrame(step);
        return;
      }
      // The old one at its own level for `outDelay` (its last words), then out over the rest.
      const out = Math.min(1, Math.max(0, passed - f.outDelay) / Math.max(1, f.ms - f.outDelay));
      const into = Math.min(1, passed / f.inMs);
      // Equal power: the sum stays as loud through the middle.
      f.from.volume = f.fromLevel * Math.cos((out * Math.PI) / 2);
      f.to.volume = this.level * Math.sin((into * Math.PI) / 2);
      if (out >= 1 && into >= 1) this.endFade();
      else f.frame = requestAnimationFrame(step);
    };
    // By the beat: silent while it is put on the beat, then the crossing.
    const start = performance.now() + (sync ? sync.quiet * 1000 : 0);
    this.fade = { from, to, start, ms, inMs: Math.max(1, Math.min(ms, inMs)), outDelay: Math.max(0, Math.min(ms - 1, outDelay)), fromLevel: fromAt, frame: requestAnimationFrame(step), done: ended, sync, jumped: 0, nudged: 0, offs: [] };
  }

  /**
   * The new track's beat on the old one's: how far off it is now (both elements' clocks read at the
   * same moment), put right by a jump while it is silent, by its speed once heard.
   */
  private keepOnBeat(f: NonNullable<DualAudio['fade']>) {
    const s = f.sync!;
    if (f.to.paused || f.from.paused || f.to.seeking) return;
    const off = f.to.currentTime - s.to - s.rate * (f.from.currentTime - s.on);
    const silent = performance.now() < f.start;
    // Still silent, or hardly heard yet (the first part of its fade in): put right by a jump.
    const early = silent || (performance.now() - f.start < 600 && Math.abs(off) > 0.02);
    if (early) {
      // A jump takes a moment to land: not another one sooner; what it still missed by teaches the next.
      if (performance.now() - f.jumped > JUMP_MS) {
        if (f.jumped && f.lastJump) this.seekLead = Math.max(0, Math.min(0.15, this.seekLead - 0.7 * off));
        f.lastJump = false;
        if (Math.abs(off) > JUMP) {
          f.to.currentTime = f.to.currentTime - off + this.seekLead * f.to.playbackRate;
          f.jumped = performance.now();
          f.lastJump = true;
        }
      }
      if (silent) return;
    }
    this.syncError.push(off);
    // By the mean since the last look: one reading strays by a few ms (the clocks' steps).
    f.offs.push(off);
    const now = performance.now();
    if (now - f.nudged < NUDGE_MS) return;
    f.nudged = now;
    const mean = f.offs.reduce((a, b) => a + b, 0) / f.offs.length;
    f.offs = [];
    const want = Math.abs(mean) > DEADBAND ? s.rate * (1 - Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, mean))) : s.rate;
    if (Math.abs(f.to.playbackRate - want) > 1e-6) f.to.playbackRate = want;
  }

  // ------------------------------------------------- the surface of one element

  get src() {
    return this.el.src;
  }
  set src(value: string) {
    this.endFade();
    // (One that failed meanwhile told nobody: loaded again here, it says so as any track does.)
    if (this.ready !== null && this.ready === value && !this.other.error) {
      // Waiting ready on the other element: that one is the one now.
      const from = this.el;
      this.active = 1 - this.active;
      from.pause();
      this.el.volume = this.level;
      this.dispatchEvent(new Event('emptied'));
    } else this.el.src = value;
    this.ready = null;
    this.stopGlide();
  }
  get currentTime() {
    return this.el.currentTime;
  }
  set currentTime(value: number) {
    this.el.currentTime = value;
  }
  get duration() {
    return this.el.duration;
  }
  get paused() {
    return this.el.paused;
  }
  get ended() {
    return this.el.ended;
  }
  get error() {
    return this.el.error;
  }
  get volume() {
    return this.level;
  }
  set volume(value: number) {
    this.level = value;
    if (!this.fade) this.el.volume = value;
  }
  get preload() {
    return this.el.preload;
  }
  set preload(value: string) {
    for (const el of this.elements) el.preload = value as HTMLMediaElement['preload'];
  }
  // Speed: both elements, so the next track of a crossfade comes in as fast. A new src resets
  // playbackRate to the default one, so that is set too.
  get playbackRate() {
    return this.el.playbackRate;
  }
  set playbackRate(value: number) {
    this.rate = value;
    this.stopGlide();
    for (const el of this.elements) if (!this.fade?.sync || el !== this.fade.to) el.playbackRate = value;
  }
  get defaultPlaybackRate() {
    return this.el.defaultPlaybackRate;
  }
  set defaultPlaybackRate(value: number) {
    for (const el of this.elements) el.defaultPlaybackRate = value;
  }
  get preservesPitch() {
    return this.el.preservesPitch;
  }
  set preservesPitch(value: boolean) {
    for (const el of this.elements) el.preservesPitch = value;
  }
  get crossOrigin() {
    return this.el.crossOrigin;
  }
  set crossOrigin(value: string | null) {
    for (const el of this.elements) el.crossOrigin = value;
  }
  play() {
    return this.el.play();
  }
  pause() {
    // A pause mid-fade ends it: what comes back is the new track alone (at the speed asked).
    const glide = this.fade?.sync;
    this.endFade();
    if (glide) this.stopGlide();
    this.el.pause();
  }
}
