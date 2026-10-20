// Beat pulse: watches the bass (≈45–190 Hz) of the playing music and sets --beat on the
// page (0…1, a quick rise on each kick, then a smooth fall) for the covers to throb to.
// Runs only while music plays, the window is visible and the pulse is switched on.

import { usePulse } from '../ui/motion.ts';
import { tapAnalyser } from './eq.ts';
import { usePlayer } from './player.ts';

let analyser: AnalyserNode | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;
let prev: Uint8Array<ArrayBuffer> | null = null;
let raf = 0;
let beat = 0;
let lastHit = 0;
/** Ignore hits closer than this: a bass line under the kick would otherwise double the beat. */
const REFRACTORY_MS = 230;
/** Recent flux values (~0.7 s at 60 fps) for the adaptive threshold. */
const window_: number[] = [];
const WINDOW = 42;

const root = () => document.documentElement.style;

/**
 * Onsets, not loudness: the rise of low-band energy from one frame to the next (spectral
 * flux), against an adaptive threshold (mean + 1.4 σ of the last moment). A sustained 808
 * bass keeps the energy high but its flux low, so only the hits count.
 */
function frame(now: number) {
  analyser!.getByteFrequencyData(bins!);
  let flux = 0;
  // bins are ~47 Hz wide at 48 kHz / 1024: 1–4 cover the kick drum and the bass
  for (let i = 1; i <= 4; i++) flux += Math.max(0, bins![i] - prev![i]);
  flux /= 4 * 255;
  prev!.set(bins!);
  window_.push(flux);
  if (window_.length > WINDOW) window_.shift();
  const mean = window_.reduce((a, b) => a + b, 0) / window_.length;
  const sd = Math.sqrt(window_.reduce((a, b) => a + (b - mean) * (b - mean), 0) / window_.length);
  if (flux > 0.012 && flux > mean + 1.4 * sd && now - lastHit > REFRACTORY_MS) {
    beat = Math.max(beat, Math.min(1, 0.4 + (flux - mean) / (4 * sd + 0.01)));
    lastHit = now;
  }
  beat *= 0.86;
  root().setProperty('--beat', beat.toFixed(3));
  raf = requestAnimationFrame(frame);
}

function update() {
  const on = usePulse.getState().enabled && usePlayer.getState().playing && !document.hidden;
  if (on && !raf) {
    analyser ??= tapAnalyser();
    bins ??= new Uint8Array(analyser.frequencyBinCount);
    prev ??= new Uint8Array(analyser.frequencyBinCount);
    raf = requestAnimationFrame(frame);
  } else if (!on && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
    beat = 0;
    root().setProperty('--beat', '0');
  }
}

/** Current pulse 0…1 (for tests). */
export const pulseLevel = () => beat;

export function startBeatPulse() {
  usePlayer.subscribe(update);
  usePulse.subscribe(update);
  document.addEventListener('visibilitychange', update);
  update();
}
