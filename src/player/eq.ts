// 10-band equalizer with a preamp ("level"), the bands of the official app (eqCurve.ts).
// audio element → preamp → low shelf 60 Hz → peaking 170 Hz … 14 kHz → high shelf 16 kHz → out.
// The Web Audio graph is built the first time the equalizer is switched on; until then
// the <audio> element plays straight to the speakers.

import { create } from 'zustand';
import { loadJson, storage, transport } from '../api/client.ts';
import { audio } from './audio.ts';
import { isIos } from '../ui/platform.ts';
import { OniPlayer } from './nativeAudio.ts';
import { bandType, EQ_BANDS, EQ_PRESETS, EQ_Q, EQ_RANGE, type EqPreset } from './eqCurve.ts';

export { EQ_BANDS, EQ_PRESETS, EQ_RANGE, type EqPreset } from './eqCurve.ts';

interface EqState {
  enabled: boolean;
  /** Overall level in dB, applied before the bands. */
  preamp: number;
  gains: number[];
  /** The preset the gains came from, or null once the user moved a band. */
  preset: EqPreset | null;
}

const KEY = 'player.eq';
export const useEq = create<EqState>(() => {
  const saved = loadJson<EqState>(KEY, { enabled: false, preamp: 0, gains: [...EQ_PRESETS.mine], preset: 'mine' });
  // "Mine" follows the preset: it was the user's curve rounded (6 for 5.8, 7.5 for 7.3, …).
  return saved.preset && EQ_PRESETS[saved.preset] ? { ...saved, gains: [...EQ_PRESETS[saved.preset]] } : saved;
});

let ctx: AudioContext | null = null;
/** Where the music comes in (both of the desktop's elements, dualAudio.ts), before the preamp. */
let input: GainNode | null = null;
let preamp: GainNode | null = null;
let filters: BiquadFilterNode[] = [];
/** The volume levelling's lift above full volume (loudness.ts), on the preamp: an element can't play louder than 1. */
let boost = 1;

/** Web Audio hears the stream only where the desktop shell arranges CORS (the beat pulse needs it). */
export const canAnalyzeAudio = () => Boolean(transport.canAnalyzeAudio);
/** The equalizer: Web Audio on the desktop, the system's on the iPhone (its player is native). */
export const canProcessAudio = () => canAnalyzeAudio() || isIos;

function build() {
  if (ctx || !canAnalyzeAudio()) return;
  ctx = new AudioContext();
  input = ctx.createGain();
  const elements = (audio as unknown as { elements?: HTMLMediaElement[] }).elements ?? [audio as HTMLMediaElement];
  for (const el of elements) ctx.createMediaElementSource(el).connect(input);
  preamp = ctx.createGain();
  filters = EQ_BANDS.map((frequency, i) => {
    const f = ctx!.createBiquadFilter();
    f.type = bandType(i);
    f.frequency.value = frequency;
    f.Q.value = EQ_Q;
    return f;
  });
  let node: AudioNode = input.connect(preamp);
  for (const f of filters) node = node.connect(f);
  node.connect(ctx.destination);
}

function apply() {
  const s = useEq.getState();
  // The iPhone: the same settings on the system equalizer of its native player.
  if (isIos) {
    OniPlayer.setEq({ enabled: s.enabled, preamp: s.preamp, gains: s.gains }).catch(() => {});
    return;
  }
  if (!s.enabled && !ctx && boost <= 1) return; // never needed: leave the element untouched
  build();
  if (!ctx) return;
  // Switched off after being on: the graph stays (an element can't be detached), set flat.
  preamp!.gain.value = (s.enabled ? Math.pow(10, s.preamp / 20) : 1) * boost;
  filters.forEach((f, i) => (f.gain.value = s.enabled ? (s.gains[i] ?? 0) : 0));
  if (ctx!.state === 'suspended') ctx!.resume().catch(() => {});
}
/**
 * An analyser on the raw music, before the equalizer (for the beat pulse). Builds the
 * audio graph if the equalizer never did; with the equalizer off the bands stay flat.
 */
export function tapAnalyser(): AnalyserNode {
  build();
  apply();
  const a = ctx!.createAnalyser();
  a.fftSize = 1024;
  a.smoothingTimeConstant = 0.5;
  input!.connect(a);
  return a;
}

/** How long after the analyser hears the music it leaves the speakers (ms): the context's own
 * buffering and the output device's (Bluetooth headphones: ~0.2 s). */
export function outputDelay() {
  if (!ctx) return 0;
  return ((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000;
}

/** The desktop's levelling above full volume (1: none); only where Web Audio hears the stream. */
export function setBoost(value: number) {
  if (isIos || value === boost) return;
  boost = value;
  apply();
}

/** The lift the audio graph gives now (1: none, or no graph): for the e2e run. */
export const levelLift = () => (ctx ? boost : 1);

function save() {
  const { enabled, preamp: p, gains, preset } = useEq.getState();
  storage.setItem(KEY, JSON.stringify({ enabled, preamp: p, gains, preset }));
}

const clamp = (v: number) => Math.max(-EQ_RANGE, Math.min(EQ_RANGE, v));

export function setEqEnabled(enabled: boolean) {
  useEq.setState({ enabled });
  apply();
  save();
}

export function setBand(index: number, gain: number) {
  const gains = [...useEq.getState().gains];
  gains[index] = clamp(gain);
  useEq.setState({ gains, preset: null });
  apply();
  save();
}

export function setPreamp(gain: number) {
  useEq.setState({ preamp: clamp(gain) });
  apply();
  save();
}

export function applyPreset(preset: EqPreset) {
  useEq.setState({ gains: [...EQ_PRESETS[preset]], preset, enabled: true });
  apply();
  save();
}

let analyser: AnalyserNode | null = null;

/**
 * RMS of what the equalizer outputs, 0…1 (for tests: a CORS-blocked stream would give 0),
 * or null while the equalizer has never been switched on.
 */
export function eqOutputLevel() {
  if (!ctx) return null;
  if (!analyser) {
    analyser = ctx.createAnalyser();
    filters[filters.length - 1].connect(analyser);
  }
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  return Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
}

// The context may start suspended until playback; wake it whenever music plays.
audio.addEventListener('play', () => {
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
});

apply();
