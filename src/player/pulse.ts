// Beat pulse: follows the beat of the playing music (src/player/beat.ts) and sets --beat on
// the page (0…1, a quick rise on each beat, then a smooth fall) for the covers to throb to.
// Runs only while music plays, the window is visible and the pulse is switched on. The desktop
// listens through Web Audio; the iPhone's music goes around the page (its own player), which
// sends the bass's rise a few frames at a time (OniPlayer.pulse) with when each is heard, and
// throbs only Now Playing's cover while it is open (the rest would cost the phone its cool).

import { useApp } from '../store.ts';
import { usePulse } from '../ui/motion.ts';
import { isIos } from '../ui/platform.ts';
import { BeatTracker } from './beat.ts';
import { canAnalyzeAudio, tapAnalyser } from './eq.ts';
import { OniPlayer } from './nativeAudio.ts';
import { audio, usePlayer } from './player.ts';

let analyser: AnalyserNode | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;
let prev: Uint8Array<ArrayBuffer> | null = null;
let raf = 0;
let beat = 0;
const tracker = new BeatTracker();

/** What throbs (styles.css, "Beat pulse"). --beat is set on these alone: set on the page's root,
 * it made the browser restyle every element 60 times a second, and a long list (Liked, ~500 rows)
 * fell from ~180 to ~35 frames a second (the user: the app often stutters). */
const PULSING = '.np-cover, .pb-cover .cover, .wave-hero.active .wave-mask';
function setBeat(value: string) {
  for (const el of document.querySelectorAll<HTMLElement>(PULSING)) el.style.setProperty('--beat', value);
}

/**
 * Low-band spectral flux per frame (the rise of 45–190 Hz energy), fed to the beat tracker,
 * which pulses on the song's beats only — not on every bump of the bass line or hi-hats.
 */
function frame(now: number) {
  analyser!.getByteFrequencyData(bins!);
  let flux = 0;
  // bins are ~47 Hz wide at 48 kHz / 1024: 1–4 cover the kick drum and the bass
  for (let i = 1; i <= 4; i++) flux += Math.max(0, bins![i] - prev![i]);
  flux /= 4 * 255;
  prev!.set(bins!);
  const hit = tracker.push(now, flux);
  if (hit) beat = Math.max(beat, hit.strength);
  beat *= 0.86;
  setBeat(beat.toFixed(3));
  raf = requestAnimationFrame(frame);
}

// ------------------------------------------------------------ the iPhone

/** Beats found in the bass the native player sent, waiting for the moment they are heard. */
const pending: { t: number; strength: number }[] = [];
let native = false;

function nativeFrame() {
  const now = performance.now();
  while (pending.length && pending[0].t <= now) beat = Math.max(beat, pending.shift()!.strength);
  beat *= 0.86;
  setBeat(beat.toFixed(3));
  raf = requestAnimationFrame(nativeFrame);
}

function updateNative() {
  const on = usePulse.getState().enabled && usePlayer.getState().playing && useApp.getState().nowPlayingOpen && !document.hidden;
  if (on === native) return;
  native = on;
  OniPlayer.pulse({ on }).catch(() => {});
  if (on) raf = requestAnimationFrame(nativeFrame);
  else {
    cancelAnimationFrame(raf);
    raf = 0;
    beat = 0;
    pending.length = 0;
    setBeat('0');
  }
}

function update() {
  if (isIos) return updateNative();
  const on = canAnalyzeAudio() && usePulse.getState().enabled && usePlayer.getState().playing && !document.hidden;
  if (on && !raf) {
    analyser ??= tapAnalyser();
    bins ??= new Uint8Array(analyser.frequencyBinCount);
    prev ??= new Uint8Array(analyser.frequencyBinCount);
    raf = requestAnimationFrame(frame);
  } else if (!on && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
    beat = 0;
    setBeat('0');
  }
}

/** Current pulse 0…1 and the tracked tempo (for tests). */
export const pulseLevel = () => beat;
export const pulseTempo = () => tracker.bpm;

export function startBeatPulse() {
  // a new track or a jump: the old tempo and grid no longer apply
  let index = usePlayer.getState().index;
  usePlayer.subscribe((s) => {
    if (s.index !== index) {
      index = s.index;
      tracker.reset();
    }
  });
  audio.addEventListener('seeked', () => tracker.reset());
  usePlayer.subscribe(update);
  usePulse.subscribe(update);
  document.addEventListener('visibilitychange', update);
  if (isIos) {
    useApp.subscribe((s, was) => s.nowPlayingOpen !== was.nowPlayingOpen && update());
    // The bass's rise, with when it is heard (wall clock): to the tracker, on the page's clock.
    OniPlayer.addListener('beat', ({ at, flux }) => {
      if (!native) return;
      const shift = performance.now() - Date.now();
      for (let i = 0; i < at.length; i++) {
        const t = at[i] + shift;
        const hit = tracker.push(t, flux[i]);
        if (hit) pending.push({ t, strength: hit.strength });
      }
    });
  }
  update();
}
