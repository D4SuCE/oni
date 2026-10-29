// The desktop's audio element for crossfades (the user's wish: one track flowing into the next).
// Two real <audio> elements behind the surface of one: the player and everything else talk to
// the one playing now; `crossfade` starts the next track on the other, fades it in while this one
// fades out, and from then on the other is the one. Events come from the playing one only (the
// fading one's "ended" is nobody's business). The equalizer takes both (`elements`).

/** Events the app listens to on its audio element. */
const EVENTS = ['play', 'playing', 'pause', 'waiting', 'canplay', 'loadedmetadata', 'durationchange', 'timeupdate', 'ended', 'error', 'seeking', 'seeked', 'emptied'];

export class DualAudio extends EventTarget {
  readonly elements: [HTMLAudioElement, HTMLAudioElement];
  private active = 0;
  /** The volume asked for; a fade scales it per element. */
  private level = 1;
  /** `ms`: the old one's fade out; `inMs`: the new one's fade in; `fromLevel`: the old one's own
   * volume, kept while it fades (the volume asked for from then on is the new track's). */
  private fade: { from: HTMLAudioElement; to: HTMLAudioElement; start: number; ms: number; inMs: number; fromLevel: number; frame: number; done: () => void } | null = null;

  constructor() {
    super();
    this.elements = [new Audio(), new Audio()];
    for (const el of this.elements) {
      el.preload = 'auto';
      for (const type of EVENTS) el.addEventListener(type, () => el === this.el && this.dispatchEvent(new Event(type)));
    }
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
    f.to.volume = this.level;
    f.done();
  }

  /**
   * Starts `url` on the other element and crosses over to it in `ms`. Resolves when it plays;
   * `ended` is called once the old one is silent (for freeing what it played). `inMs`: the new
   * one comes in this fast (the old one already quiet: nothing to blend with, see player.ts);
   * `fromLevel`: the old one's volume as it fades (its own level, not the new track's).
   */
  async crossfade(url: string, ms: number, ended: () => void = () => {}, startAt = 0, { inMs = ms, fromLevel }: { inMs?: number; fromLevel?: number } = {}) {
    this.endFade();
    const from = this.el;
    const fromAt = Math.max(0, Math.min(1, fromLevel ?? from.volume));
    const to = this.other;
    to.src = url;
    // Past its silence at the start (the smart crossfade, silence.ts).
    if (startAt > 0) to.currentTime = startAt;
    to.volume = 0;
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
      const passed = performance.now() - f.start;
      const out = Math.min(1, passed / f.ms);
      const into = Math.min(1, passed / f.inMs);
      // Equal power: the sum stays as loud through the middle.
      f.from.volume = f.fromLevel * Math.cos((out * Math.PI) / 2);
      f.to.volume = this.level * Math.sin((into * Math.PI) / 2);
      if (out >= 1 && into >= 1) this.endFade();
      else f.frame = requestAnimationFrame(step);
    };
    this.fade = { from, to, start: performance.now(), ms, inMs: Math.max(1, Math.min(ms, inMs)), fromLevel: fromAt, frame: requestAnimationFrame(step), done: ended };
  }

  // ------------------------------------------------- the surface of one element

  get src() {
    return this.el.src;
  }
  set src(value: string) {
    this.endFade();
    this.el.src = value;
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
    for (const el of this.elements) el.playbackRate = value;
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
    // A pause mid-fade ends it: what comes back is the new track alone.
    this.endFade();
    this.el.pause();
  }
}
