// The beat grid of a stretch of music, for the DJ-like transition (automix.ts): its tempo and where
// its beats fall, from the samples alone (a track's last or first ~40 s, decoded). Pure, so it is
// tested offline on real songs (tests/automix.test.ts).
//
// The way is the usual one (Ellis 2007, as in librosa): how much the spectrum rises in each short
// frame (onsets: drums, the attacks of notes), the tempo whose period that repeats at best (with a
// liking for ~120 BPM, the octave mistakes are the common ones), then the beats picked along it by
// dynamic programming, and a straight line through them: one tempo and one phase, and how far the
// beats stray from it (a live drummer's do; a drum machine's hardly). The transition matches beats
// only where the grid is steady and sure.

/** Frame hop and window, in samples, at the rate given (11025 Hz: 11.6 ms and 93 ms). */
const HOP = 128;
const WINDOW = 1024;
/** An onset shows in the frames this much before the hit (s): the rise starts as the hit enters the
 * window, before its middle. Measured on drum loops at 92–174 BPM: 35.5 ± 1 ms at any tempo. */
const EARLY = 0.0355;
/** Tempi looked at (BPM). */
const MIN_BPM = 60;
const MAX_BPM = 200;
/** The liking for tempi near this, an octave either way halving it (log-normal). */
const PRIOR_BPM = 120;
/** The beat tracker's dislike of beats off the tempo (Ellis's alpha). */
const TIGHTNESS = 100;

export interface Grid {
  /** Beats per minute. */
  bpm: number;
  /** Seconds a beat. */
  period: number;
  /** The beats found (seconds into the samples), each on its own onset. */
  beats: number[];
  /** The straight line's beat 0 (seconds): beat k is at `anchor + k * period`. */
  anchor: number;
  /** How far the beats stray from the line (RMS, seconds). */
  wobble: number;
  /** 0…1: how clearly the onsets repeat at that period (the autocorrelation's peak against its mean). */
  clarity: number;
  /** 0…1: the share of the stretch's beats with an onset picked within 25 ms of the line. */
  onLine: number;
}


/** In-place radix-2 FFT of re/im (length a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/**
 * The onset strength of each frame: the rise of the log spectrum, summed over bins, with the local
 * mean taken off. Frame f is centred at `f * HOP / rate` seconds.
 */
export function onsets(samples: Float32Array, rate: number): Float64Array {
  return bands(samples, rate).all;
}

/** Below this the spectrum hardly moves (a held pad, silence): no beat to find (flux's RMS, log units). */
const STILL = 2;

/** The onsets of all the spectrum and of the lows alone (30–160 Hz: the kick), each to unit spread;
 * `level`: how much the spectrum moves at all (the flux's RMS before that). */
function bands(samples: Float32Array, rate: number): { all: Float64Array; low: Float64Array; level: number } {
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / HOP) + 1);
  const bins = WINDOW / 2;
  const hann = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW));
  // Up to ~5 kHz: above it, at 11025 Hz, there is nothing; below 30 Hz only rumble.
  const lo = Math.max(1, Math.floor((30 * WINDOW) / rate));
  const hi = Math.min(bins, Math.ceil((5000 * WINDOW) / rate));
  const kick = Math.ceil((160 * WINDOW) / rate);
  const re = new Float64Array(WINDOW);
  const im = new Float64Array(WINDOW);
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  const flux = new Float64Array(frames);
  const lowFlux = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    for (let i = 0; i < WINDOW; i++) {
      re[i] = samples[at + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    let low = 0;
    for (let b = lo; b < hi; b++) {
      cur[b] = Math.log1p(1000 * Math.hypot(re[b], im[b]));
      const rise = f > 0 ? Math.max(0, cur[b] - prev[b]) : 0;
      sum += rise;
      if (b <= kick) low += rise;
    }
    flux[f] = sum;
    lowFlux[f] = low;
    [prev, cur] = [cur, prev];
  }
  let level = 0;
  for (const v of flux) level += v * v;
  level = Math.sqrt(level / Math.max(1, frames));
  return { all: detrend(flux, rate), low: detrend(lowFlux, rate), level };
}

/** The local mean (~1.5 s) taken off — a crescendo is no onset — and to unit spread, so TIGHTNESS
 * means the same for any loudness. */
function detrend(flux: Float64Array, rate: number) {
  const frames = flux.length;
  const span = Math.round((0.75 * rate) / HOP);
  const out = new Float64Array(frames);
  let acc = 0;
  let from = 0;
  let to = 0;
  for (let f = 0; f < frames; f++) {
    while (to < frames && to <= f + span) acc += flux[to++];
    while (from < f - span) acc -= flux[from++];
    out[f] = Math.max(0, flux[f] - acc / (to - from));
  }
  let sd = 0;
  for (const v of out) sd += v * v;
  sd = Math.sqrt(sd / Math.max(1, frames)) || 1;
  for (let f = 0; f < frames; f++) out[f] /= sd;
  return out;
}

/** The tempo's period in frames (a fraction), and how clear it is. */
function tempo(env: Float64Array, fps: number): { lag: number; clarity: number } | null {
  const minLag = Math.floor((60 / MAX_BPM) * fps);
  const maxLag = Math.ceil((60 / MIN_BPM) * fps);
  if (env.length < maxLag * 4) return null;
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = 0; lag < ac.length && lag < env.length; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    ac[lag] = s / (env.length - lag);
  }
  let best = -1;
  let bestScore = -Infinity;
  let mean = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / 0.9) ** 2);
    // A beat's period repeats at twice it too.
    const score = (ac[lag] + 0.5 * ac[2 * lag]) * prior;
    mean += ac[lag];
    if (score > bestScore) [best, bestScore] = [lag, score];
  }
  mean /= maxLag - minLag + 1;
  if (best < 0 || ac[best] <= 0) return null;
  // Between frames: the parabola through the peak and its neighbours.
  const [a, b, c] = [ac[best - 1], ac[best], ac[best + 1]];
  const shift = a - 2 * b + c < 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  return { lag: best + Math.max(-0.5, Math.min(0.5, shift)), clarity: Math.max(0, Math.min(1, 1 - mean / ac[best])) };
}

/** Beats along the period by dynamic programming (frames), then each moved to its onset's peak. */
function track(env: Float64Array, lag: number): number[] {
  const n = env.length;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let from = -1;
    const lo = Math.max(0, Math.round(t - 2 * lag));
    const hi = Math.round(t - lag / 2);
    for (let p = lo; p <= hi; p++) {
      const s = score[p] - TIGHTNESS * Math.log((t - p) / lag) ** 2;
      if (s > best || from < 0) [best, from] = [s, p];
    }
    score[t] = env[t] + (from >= 0 ? best : 0);
    back[t] = from;
  }
  // From the best score within the last period back.
  let t = n - 1;
  for (let i = Math.max(0, Math.floor(n - lag)); i < n; i++) if (score[i] > score[t]) t = i;
  const beats: number[] = [];
  for (; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  return beats.map((f) => {
    const [a, b, c] = [env[f - 1] ?? 0, env[f], env[f + 1] ?? 0];
    return f + (a - 2 * b + c < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / (a - 2 * b + c))) : 0);
  });
}

/**
 * The grid of `samples` (mono, `rate` Hz). Null when there is no tempo to speak of (too short, or
 * no onsets). The frame's time is its window's middle.
 */
export function beatGrid(samples: Float32Array, rate: number): Grid | null {
  const { all: env, low, level } = bands(samples, rate);
  if (level < STILL) return null;
  const fps = rate / HOP;
  const found = tempo(env, fps);
  if (!found) return null;
  const frames = track(env, found.lag);
  if (frames.length < 8) return null;
  const time = (f: number) => (f * HOP + WINDOW / 2) / rate + EARLY;
  const beats = frames.map(time);
  // Each beat's number on the line: a skipped or doubled pick does not shift the ones after it.
  const p0 = (found.lag * HOP) / rate;
  const index = beats.map((b) => Math.round((b - beats[0]) / p0));
  // The straight line through them, least squares; then again without the ones far off it (a
  // pick on an off-beat hit), so a few strays do not bend it.
  let use = beats.map((_, i) => i);
  let line = fit(beats, index, use);
  for (let round = 0; round < 3; round++) {
    const off = use.map((i) => Math.abs(beats[i] - (line.anchor + index[i] * line.period)));
    const sd = Math.sqrt(off.reduce((s, v) => s + v * v, 0) / off.length);
    const kept = use.filter((_, j) => off[j] <= Math.max(0.02, 2 * sd));
    if (kept.length === use.length || kept.length < 8) break;
    use = kept;
    line = fit(beats, index, use);
  }
  const offs = beats.map((b, i) => Math.abs(b - (line.anchor + index[i] * line.period)));
  const wobble = Math.sqrt(use.reduce((s, i) => s + offs[i] ** 2, 0) / use.length);
  // How many beats of the stretch the line has a pick on, within 25 ms.
  const span = index[index.length - 1] - index[0] + 1;
  const onLine = offs.filter((o) => o <= 0.025).length / span;
  // The beat or the half-beat between: a hi-hat's rise spans more of the spectrum than a kick's, and
  // the line could sit on the off-beats. The beat is where the lows (the kick) rise.
  const lowAt = (t: number) => {
    const f = ((t - EARLY) * rate - WINDOW / 2) / HOP;
    const i = Math.floor(f);
    if (i < 0 || i + 1 >= low.length) return 0;
    return low[i] + (f - i) * (low[i + 1] - low[i]);
  };
  const sumAt = (shift: number) => {
    let s = 0;
    for (let t = line.anchor + shift; t < samples.length / rate; t += line.period) if (t >= 0) s += lowAt(t);
    return s;
  };
  let anchor = sumAt(line.period / 2) > 1.2 * sumAt(0) ? line.anchor + line.period / 2 : line.anchor;
  // Then onto the kicks themselves, within an eighth of a beat (the line came from all the onsets).
  if (sumAt(anchor - line.anchor) > 0) {
    let best = 0;
    let bestSum = -Infinity;
    for (let d = -line.period / 8; d <= line.period / 8; d += 0.002) {
      const v = sumAt(anchor - line.anchor + d);
      if (v > bestSum) [best, bestSum] = [d, v];
    }
    anchor += best;
  }
  return { bpm: 60 / line.period, period: line.period, beats, anchor, wobble, clarity: found.clarity, onLine };
}

function fit(beats: number[], index: number[], use: number[]) {
  const n = use.length;
  const mx = use.reduce((s, i) => s + index[i], 0) / n;
  const my = use.reduce((s, i) => s + beats[i], 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const i of use) {
    sxy += (index[i] - mx) * (beats[i] - my);
    sxx += (index[i] - mx) ** 2;
  }
  const period = sxy / sxx;
  return { period, anchor: my - period * mx };
}
