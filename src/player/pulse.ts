// Beat pulse: follows the kick drum of the playing music (src/player/beat.ts) and sets --beat
// on the page (0…1, a quick rise on each kick, then a smooth fall) for the covers to throb to.
// Runs only while music plays, the window is visible and the pulse is switched on. The desktop
// listens through Web Audio (and throbs when the kick leaves the speakers, its output's delay
// later: Bluetooth headphones are ~0.2 s behind the analyser); the iPhone's music goes around
// the page (its own player), which sends the bass's low bins a few frames at a time
// (OniPlayer.pulse) with when each is heard, and throbs only Now Playing's cover while it is
// open (the rest would cost the phone its cool).

import { useApp } from '../store.ts';
import { usePulse } from '../ui/motion.ts';
import { isIos } from '../ui/platform.ts';
import { KickDetector, bassFlux, bassLoudness } from './beat.ts';
import { canAnalyzeAudio, outputDelay, tapAnalyser } from './eq.ts';
import { OniPlayer } from './nativeAudio.ts';
import { audio, usePlayer } from './player.ts';

let analyser: AnalyserNode | null = null;
let bins: Float32Array<ArrayBuffer> | null = null;
let prev: Float32Array<ArrayBuffer> | null = null;
let raf = 0;
let beat = 0;
/** Kicks found, waiting for the moment they are heard. */
const pending: { t: number; strength: number }[] = [];
const tracker = new KickDetector();

/** What throbs (styles.css, "Beat pulse"). --beat is set on these alone: set on the page's root,
 * it made the browser restyle every element 60 times a second, and a long list (Liked, ~500 rows)
 * fell from ~180 to ~35 frames a second (the user: the app often stutters). */
const PULSING = '.np-cover, .pb-cover .cover, .wave-hero.active .wave-mask';
function setBeat(value: string) {
  for (const el of document.querySelectorAll<HTMLElement>(PULSING)) el.style.setProperty('--beat', value);
}

/**
 * Low-band spectral flux per frame (the rise of 45–190 Hz energy, `bassFlux`), fed to the
 * kick detector, which pulses on the kick drum only — not on every bump of the bass line.
 * A kick throbs when it is heard: after the output's delay (the iPhone's kicks wait the same way).
 */
function frame(now: number) {
  analyser!.getFloatFrequencyData(bins!);
  const hit = tracker.push(now, bassFlux(bins!, prev!), bassLoudness(bins!));
  prev!.set(bins!);
  if (hit) pending.push({ t: now + outputDelay(), strength: hit.strength });
  while (pending.length && pending[0].t <= now) beat = Math.max(beat, pending.shift()!.strength);
  beat *= 0.86;
  setBeat(beat.toFixed(3));
  raf = requestAnimationFrame(frame);
}

// ------------------------------------------------------------ the iPhone

let native = false;
/** For the simulator run: what came from the native player, what the tracker made of it, and the
 * highest throb the cover got (`peak`: kept here, as a check every 40 ms missed the few beats a
 * slow cloud Mac finds — the throb rises and falls between two looks). */
const seen = { batches: 0, values: 0, maxFlux: 0, hits: 0, late: 0, peak: 0 };
export const pulseDebug = () => ({ native, ...seen, open: useApp.getState().nowPlayingOpen, enabled: usePulse.getState().enabled, playing: usePlayer.getState().playing });
export function resetPulseDebug() {
  Object.assign(seen, { batches: 0, values: 0, maxFlux: 0, hits: 0, late: 0, peak: 0 });
}

function nativeFrame() {
  const now = performance.now();
  while (pending.length && pending[0].t <= now) beat = Math.max(beat, pending.shift()!.strength);
  seen.peak = Math.max(seen.peak, beat);
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
    bins ??= new Float32Array(analyser.frequencyBinCount);
    prev ??= new Float32Array(analyser.frequencyBinCount).fill(-Infinity);
    raf = requestAnimationFrame(frame);
  } else if (!on && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
    beat = 0;
    pending.length = 0;
    setBeat('0');
  }
}

/** Current pulse 0…1 (for tests). */
export const pulseLevel = () => beat;

export function startBeatPulse() {
  // a new track or a jump: the old loudness no longer applies
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
    // The bass's four low bins, with when they are heard (wall clock): their rise to the kick
    // detector, on the page's clock — as the desktop's analyser gives them.
    let before = new Float32Array(5).fill(-Infinity);
    OniPlayer.addListener('beat', ({ at, db }) => {
      seen.batches++;
      if (!native) return;
      const shift = performance.now() - Date.now();
      for (let i = 0; i < at.length; i++) {
        const t = at[i] + shift;
        const bins = Float32Array.of(-Infinity, db[4 * i], db[4 * i + 1], db[4 * i + 2], db[4 * i + 3]);
        const flux = bassFlux(bins, before);
        before = bins;
        seen.values++;
        seen.maxFlux = Math.max(seen.maxFlux, flux);
        if (t < performance.now()) seen.late++;
        const hit = tracker.push(t, flux, bassLoudness(bins));
        if (hit) {
          seen.hits++;
          pending.push({ t, strength: hit.strength });
        }
      }
    });
  }
  update();
}
