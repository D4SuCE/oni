// 10-band equalizer with a preamp ("level"), the bands of the official app.
// audio element → preamp → low shelf 60 Hz → peaking 170 Hz … 14 kHz → high shelf 16 kHz → out.
// The Web Audio graph is built the first time the equalizer is switched on; until then
// the <audio> element plays straight to the speakers.

import { create } from 'zustand';
import { loadJson, storage, transport } from '../api/client.ts';
import { audio } from './audio.ts';
import { processingOn } from './processing.ts';

export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
export const EQ_RANGE = 12;

export type EqPreset = 'mine' | 'flat' | 'bass' | 'treble' | 'rock' | 'pop' | 'electronic' | 'hiphop' | 'vocal' | 'classical' | 'jazz';

export const EQ_PRESETS: Record<EqPreset, number[]> = {
  // the user's own curve from the official app: warm lows, a dip around 600 Hz, bright highs
  mine: [6, 5, 2, -2, -1, 1, 1.5, 5.5, 7.5, 7.5],
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0],
  treble: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7],
  rock: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5],
  pop: [-1, 1, 3, 4, 3, 1, -1, -1, -1, -1],
  electronic: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5],
  hiphop: [6, 5, 1, 2, -1, -1, 1, -1, 2, 3],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  jazz: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
};

interface EqState {
  enabled: boolean;
  /** Overall level in dB, applied before the bands. */
  preamp: number;
  gains: number[];
  /** The preset the gains came from, or null once the user moved a band. */
  preset: EqPreset | null;
}

const KEY = 'player.eq';
export const useEq = create<EqState>(() => loadJson<EqState>(KEY, { enabled: false, preamp: 0, gains: [...EQ_PRESETS.mine], preset: 'mine' }));

let ctx: AudioContext | null = null;
let source: MediaElementAudioSourceNode | null = null;
let preamp: GainNode | null = null;
let filters: BiquadFilterNode[] = [];
/** The last stage: the volume, where the element's own cannot be set (iOS ignores audio.volume). */
let output: GainNode | null = null;

/** Without a same-origin stream Web Audio would only hear silence and mute the music: the desktop
 * shell arranges CORS; the iPhone plays from memory when processing is on (processing.ts). */
export const canProcessAudio = () => Boolean(transport.canAnalyzeAudio) || processingOn;

function build() {
  if (ctx || !canProcessAudio()) return;
  ctx = new AudioContext();
  source = ctx.createMediaElementSource(audio);
  preamp = ctx.createGain();
  filters = EQ_BANDS.map((frequency, i) => {
    const f = ctx!.createBiquadFilter();
    f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
    f.frequency.value = frequency;
    f.Q.value = 1.1;
    return f;
  });
  output = ctx.createGain();
  let node: AudioNode = source.connect(preamp);
  for (const f of filters) node = node.connect(f);
  node.connect(output).connect(ctx.destination);
}

/** The iPhone with processing: the graph from the first track on, so its volume works. */
export function routeThroughGraph() {
  if (!ctx && processingOn) {
    build();
    // Woken and covered for when iOS suspends it in the background (background.ts).
    import('./background.ts').then((m) => m.keepSoundInBackground());
  }
  build();
  apply();
}

/** The graph's context, once built (background.ts watches it). */
export const audioContext = () => ctx;

/** Volume at the end of the graph (the iPhone); the desktop keeps using audio.volume. */
export function setOutputGain(gain: number) {
  if (output) output.gain.value = gain;
}

function apply() {
  const s = useEq.getState();
  if (!s.enabled && !ctx && !processingOn) return; // never switched on: leave the element untouched
  build();
  if (!ctx) return;
  // Switched off after being on: the graph stays (an element can't be detached), set flat.
  preamp!.gain.value = s.enabled ? Math.pow(10, s.preamp / 20) : 1;
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
  source!.connect(a);
  return a;
}

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
