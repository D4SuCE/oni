// Playback: one <audio> element, a queue, wave integration, listening history
// and OS media controls (Windows SMTC / iOS lock screen via Media Session).

import { create } from 'zustand';
import type { Track } from '../api/types.ts';
import { api, loadJson, storage, transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { artistNames, trackCover, type StreamQuality } from '../api/yandex.ts';
import { DEFAULT_TUNING, WaveEngine, waveSeeds, type WaveStats, type WaveTuning } from '../wave/engine.ts';
import { ListenHistory } from '../wave/history.ts';
import { playOutcome, RecsFeedback } from '../recs/feedback.ts';
import { RecentPlays } from './recent.ts';
import { levellingGain } from './loudness.ts';
import { OfflineLibrary } from './offline.ts';
import { PlayStats, type Origin } from './stats.ts';
import { isIos } from '../ui/platform.ts';
import { audio } from './audio.ts';
import { audioExt, OniPlayer, type NativeAudio } from './nativeAudio.ts';

export type Repeat = 'off' | 'all' | 'one';
/** A wave without a station is My Wave; with one it is a radio seeded by a track, artist, album or playlist. */
/** Where a list came from, reported to Yandex with each play so its history groups plays right. */
export interface PlayContext {
  /** "<uid>:<kind>" */
  playlist?: string;
  album?: number | string;
}
export type Source =
  | { kind: 'wave'; station?: { seed: string; title: string } }
  /**
   * `suggested`: ids Smart Shuffle added to the list (shown with ✦ in the queue);
   * `origin`: which recommendation it came from, for the stats in Settings.
   */
  | { kind: 'list'; title: string; from?: PlayContext; suggested?: string[]; origin?: Origin };

export interface PlayExtra {
  suggested?: string[];
  origin?: Origin;
}

export function sourceTitle(source: Source | null) {
  if (source?.kind === 'list') return source.title;
  return source?.station ? tr().common.radioOf(source.station.title) : tr().common.myWave;
}

export const isMyWave = (source: Source | null) => source?.kind === 'wave' && !source.station;

interface Prefs {
  volume: number;
  repeat: Repeat;
  normalize: boolean;
  quality: StreamQuality;
}

export interface PlayerState extends Prefs {
  queue: Track[];
  index: number;
  source: Source | null;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  tuning: WaveTuning;
  waveStats: WaveStats | null;
  waveBusy: boolean;
  error: string | null;
  /** What Yandex actually serves for the current track (it can be less than asked). */
  stream: { codec: string; bitrate: number } | null;
}

const prefs = loadJson<Prefs>('player.prefs', { volume: 0.8, repeat: 'off', normalize: true, quality: 'lossless' });

export const usePlayer = create<PlayerState>(() => ({
  ...prefs,
  queue: [],
  index: -1,
  source: null,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  shuffle: false,
  tuning: loadJson<WaveTuning>('wave.tuning', DEFAULT_TUNING),
  waveStats: null,
  waveBusy: false,
  error: null,
  stream: null,
}));

const set = usePlayer.setState;
const get = usePlayer.getState;

export const history = new ListenHistory(storage);
/** Hidden tracks and demoted artists, for the mixes. */
export const recsFeedback = new RecsFeedback(storage);
/** Downloaded tracks; null where the shell keeps no files. */
export const offline =
  transport.files && transport.fetchBytes
    ? new OfflineLibrary({
        files: transport.files,
        fetchBytes: (url) => transport.fetchBytes!(url),
        stream: (id) => api.stream(id, get().quality),
        store: storage,
        crypto,
      })
    : null;
offline?.reconcile();

/** No network (set by the app store): only downloaded tracks can play, the rest are skipped at once. */
let offlineMode = false;
export const setOfflineMode = (on: boolean) => {
  offlineMode = on;
};

/** The object URL of the downloaded track playing now; freed when the next one loads. */
let localUrl: string | null = null;
function setLocalAudio(blob: Blob | null) {
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = blob ? URL.createObjectURL(blob) : null;
  return localUrl;
}
export const recentPlays = new RecentPlays(storage);
export const stats = new PlayStats(storage);
/** Bumped on every new entry so the History page re-reads the list. */
export const useRecent = create<{ version: number }>(() => ({ version: 0 }));
export { audio };

let engine: WaveEngine | null = null;
const waveApi = transport.testMode ? { waveStart: api.waveStart.bind(api), waveMore: api.waveMore.bind(api), waveFeedback: async () => {} } : api;
let isDisliked: (id: string) => boolean = () => false;
let loadSeq = 0;
let listened = 0;
let lastTime = 0;
let unshuffled: Track[] | null = null;
const prefetched = new Map<string, { url: string; at: number; codec: string; bitrate: number }>();
const STREAM_TTL = 90_000;

export const current = () => {
  const s = get();
  return s.queue[s.index] as Track | undefined;
};

export function setDislikedCheck(fn: (id: string) => boolean) {
  isDisliked = fn;
}

// ------------------------------------------------------------------- loading

async function streamUrl(t: Track) {
  const cached = prefetched.get(t.id);
  if (cached && Date.now() - cached.at < STREAM_TTL) return cached;
  const s = await api.stream(t.id, get().quality);
  const entry = { url: s.url, at: Date.now(), codec: s.codec, bitrate: s.bitrate };
  prefetched.set(t.id, entry);
  return entry;
}

function prefetchNext() {
  const s = get();
  const next = s.queue[s.index + 1];
  if (!next || offlineMode || offline?.has(next.id)) return;
  // The iPhone's player fetches a track whole before it plays: the next one is fetched now.
  if (isIos) streamUrl(next).then((st) => OniPlayer.fetch({ id: String(next.id), url: st.url, ext: audioExt(st.codec) })).catch(() => {});
  else if (!prefetched.has(next.id)) streamUrl(next).catch(() => {});
}

function applyVolume() {
  const s = get();
  const gain = s.normalize ? levellingGain(current()?.r128?.i) : 1;
  // On the iPhone the volume is the phone's (volume.ts): only the levelling is ours, on its player.
  if (isIos) OniPlayer.setGain({ value: Math.min(1, gain) }).catch(() => {});
  else audio.volume = Math.max(0, Math.min(1, s.volume * gain));
}

async function loadAt(index: number, autoplay = true) {
  const t = get().queue[index];
  if (!t) return;
  const seq = ++loadSeq;
  set({ index, loading: true, position: 0, duration: (t.durationMs || 0) / 1000, error: null });
  listened = 0;
  play = { id: crypto.randomUUID(), startedAt: new Date() };
  lastTime = 0;
  updateMediaSession(t);
  try {
    if (offlineMode && !offline?.has(t.id)) throw new Error('not downloaded and no network');
    // A downloaded copy plays first: it needs no network and no traffic.
    const local = offline?.has(t.id) ? await offline.open(t.id).catch(() => null) : null;
    const stream = local ? { url: '', codec: local.entry.codec, bitrate: local.entry.bitrate } : await streamUrl(t);
    if (seq !== loadSeq) return;
    if (isIos) {
      // The native player is told which track it opens and which files to keep (this and the next).
      const nextId = get().queue[index + 1]?.id;
      (audio as unknown as NativeAudio).next = { id: String(t.id), ext: audioExt(local ? local.entry.codec : stream.codec), keep: [String(t.id), ...(nextId ? [String(nextId)] : [])] };
    }
    audio.src = local ? setLocalAudio(local.blob)! : stream.url;
    if (!local) setLocalAudio(null);
    set({ stream: { codec: stream.codec, bitrate: stream.bitrate } });
    applyVolume();
    if (autoplay) await audio.play();
    if (get().source?.kind === 'wave') engine?.feedback('trackStarted', t);
    prefetchNext();
    if (get().source?.kind === 'wave') fillWave();
  } catch (e: any) {
    if (seq !== loadSeq || e?.name === 'AbortError') return;
    set({ loading: false, error: tr().player.cantPlay(t.title) });
    setTimeout(() => seq === loadSeq && next(false), offlineMode ? 0 : 1500);
  }
  persistSoon();
}

/** Called whenever we leave the current track, before switching. */
function finishCurrent(ended: boolean) {
  const t = current();
  if (!t || (listened < 1 && !ended)) return;
  history.record(t, listened, ended);
  stats.record(originOf(t), listened, (t.durationMs || 0) / 1000, ended);
  recsFeedback.recordPlay(t, playOutcome(listened, (t.durationMs || 0) / 1000, ended), Date.now());
  reportPlay(t, ended);
  if (ended || listened >= 5) {
    const source = get().source;
    recentPlays.add({ track: t, at: play.startedAt.getTime(), source: sourceTitle(source), from: source?.kind === 'list' ? source.from : undefined });
    useRecent.setState((s) => ({ version: s.version + 1 }));
  }
  if (get().source?.kind === 'wave') {
    engine?.feedback(ended ? 'trackFinished' : 'skip', t, listened);
    set({ waveStats: engine ? { ...engine.stats } : null });
  }
  listened = 0;
}

function originOf(t: Track): Origin {
  const s = get().source;
  if (s?.kind === 'wave') return s.station ? 'radio' : 'wave';
  if (s?.suggested?.includes(String(t.id))) return 'smart';
  return s?.origin ?? 'list';
}

/** Current play for the Yandex listening report. */
let play = { id: '', startedAt: new Date() };

function reportPlay(t: Track, ended: boolean) {
  const source = get().source;
  // Wave plays reach Yandex through the radio session feedback; tests must not touch the history.
  if (source?.kind !== 'list' || transport.testMode || listened < 1) return;
  api
    .reportPlay({
      track: t,
      playId: play.id,
      startedAt: play.startedAt,
      playedSeconds: listened,
      endSeconds: ended ? (t.durationMs || 0) / 1000 : audio.currentTime,
      ...source.from,
    })
    .catch((e) => console.warn('play report failed', e));
}

// ---------------------------------------------------------------------- wave

/** The fill in progress, per engine: a new wave (re-tuned, restarted) never waits on the old
 * one's request, which could hang and leave "next" with nothing to play. */
let filling: { engine: WaveEngine; done: Promise<void>; at: number; id: number } | null = null;
let fills = 0;
/** A wave request that has not answered by then is given up (the phone in the background could
 * hold one for good, and "next" waited on it even after the screen was unlocked). */
const FILL_TIMEOUT = 15_000;
/** Tracks kept ready ahead: more on the iPhone, where the page may be held in the background. */
const WAVE_AHEAD = isIos ? 4 : 2;

const withTimeout = <T,>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('wave request timed out')), FILL_TIMEOUT))]);

function fillWave(min = WAVE_AHEAD): Promise<void> {
  const mine = engine;
  if (!mine) return Promise.resolve();
  if (filling?.engine === mine && Date.now() - filling.at < FILL_TIMEOUT) return filling.done;
  const id = ++fills;
  const done = (async () => {
    try {
      while (engine === mine && get().source?.kind === 'wave' && get().queue.length - get().index - 1 < min) {
        const t = await withTimeout(mine.next());
        // A replaced engine's track belongs to a wave that is gone.
        if (!t || engine !== mine) break;
        set((s) => ({ queue: [...s.queue, t], waveStats: { ...mine.stats } }));
      }
      if (engine === mine) prefetchNext();
    } catch (e) {
      console.warn('wave fill failed', e);
    } finally {
      if (filling?.id === id) filling = null;
    }
  })();
  filling = { engine: mine, done, at: Date.now(), id };
  return done;
}

export async function playWave(tuning?: Partial<WaveTuning>) {
  if (tuning) saveTuning(tuning);
  await startWave({ kind: 'wave' });
}

/** Endless radio from one seed, e.g. `track:123`, `artist:45`, `album:67`, `playlist:<uid>:<kind>`. Repeat filters apply. */
export async function playRadio(seed: string, title: string) {
  await startWave({ kind: 'wave', station: { seed, title } });
}

/** Plays on the account's other devices, so the wave's repeat filter is the account's and not
 * this device's (what was heard on the PC is not repeated on the phone). Refreshed at most every
 * few minutes; a slow answer does not hold the wave up. */
let remoteHistoryAt = 0;
async function syncRemoteHistory() {
  if (Date.now() - remoteHistoryAt < 5 * 60_000) return;
  try {
    history.mergeRemote(await api.musicHistoryPlays());
    remoteHistoryAt = Date.now();
  } catch (e) {
    console.warn('account history unavailable', e);
  }
}

/** Bumped by every start: a start overtaken by a newer one (a setting picked again meanwhile)
 * stops quietly instead of loading its track over the newer wave's. */
let waveStarts = 0;

async function startWave(source: Source & { kind: 'wave' }) {
  const start = ++waveStarts;
  finishCurrent(false);
  // The old track plays on until the new wave's first one is ready (the user's choice).
  const mine = new WaveEngine(waveApi, history, get().tuning, (id) => isDisliked(id), source.station ? [source.station.seed] : null);
  engine = mine;
  set({ waveBusy: true, source, queue: [], index: -1, shuffle: false, error: null });
  unshuffled = null;
  try {
    await Promise.race([syncRemoteHistory(), new Promise((r) => setTimeout(r, 2500))]);
    await withTimeout(mine.start());
    const first = await withTimeout(mine.next());
    if (start !== waveStarts) return;
    if (!first) throw new Error(tr().player.waveEmpty);
    set({ queue: [first], waveStats: { ...mine.stats } });
    await loadAt(0);
  } catch (e: any) {
    if (start === waveStarts) set({ error: tr().player.waveFailed(String(e?.message || e)) });
  } finally {
    if (start === waveStarts) set({ waveBusy: false });
  }
}

export function saveTuning(patch: Partial<WaveTuning>) {
  const before = get().tuning;
  const tuning = { ...before, ...patch };
  set({ tuning });
  storage.setItem('wave.tuning', JSON.stringify(tuning));
  if (engine) Object.assign(engine.tuning, tuning);
  return waveSeeds(before).join() !== waveSeeds(tuning).join();
}

/** Re-tune the wave. Local filters keep the current track and drop what no longer passes; a
 * Yandex-side setting (activity, character, mood, language) starts My Wave anew with it right
 * away, as Yandex's app does, whatever was playing: a list, My Wave, or a station radio. */
export async function retuneWave(patch: Partial<WaveTuning>) {
  const seedsChanged = saveTuning(patch);
  const source = get().source;
  // Local filters only: the wave (My Wave or a station) keeps its seed and drops what fails them.
  if (source?.kind === 'wave' && !seedsChanged) {
    set((s) => ({ queue: s.queue.filter((t, i) => i <= s.index || !engine?.rejectReason(t)) }));
    await fillWave();
    return;
  }
  // A Yandex-side setting starts My Wave with it, also from a station radio (a track's, an
  // artist's): there the setting used to do nothing at all, and the radio's track went on.
  if (seedsChanged) await startWave({ kind: 'wave' });
}

export function waveFeedback(type: 'like' | 'dislike', t: Track) {
  if (get().source?.kind === 'wave') engine?.feedback(type, t);
}

// ------------------------------------------------------------------ controls

export async function playTracks(tracks: Track[], start = 0, title = tr().common.list, from?: PlayContext, extra: PlayExtra = {}) {
  finishCurrent(false);
  engine = null;
  const playable = tracks.filter((t) => t.available !== false);
  const startTrack = tracks[start];
  const index = Math.max(0, playable.indexOf(startTrack));
  unshuffled = null;
  set({ queue: playable, source: { kind: 'list', title, from, ...extra }, shuffle: false, waveStats: null });
  await loadAt(index);
}

export async function playShuffled(tracks: Track[], title = tr().common.list, from?: PlayContext, extra: PlayExtra = {}) {
  const playable = tracks.filter((t) => t.available !== false);
  await playTracks(shuffleArray(playable), 0, title, from, extra);
}

export function toggle() {
  if (!current()) return;
  if (audio.paused) {
    if (!audio.src) loadAt(get().index);
    else audio.play().catch(() => {});
  } else audio.pause();
}

export async function next(user = true) {
  const s = get();
  if (!s.queue.length) return;
  finishCurrent(!user);
  if (s.index + 1 < s.queue.length) return loadAt(s.index + 1);
  if (s.source?.kind === 'wave') {
    await fillWave(1);
    if (get().index + 1 < get().queue.length) return loadAt(get().index + 1);
    return;
  }
  if (s.repeat === 'all') return loadAt(0);
  audio.pause();
}

export function prev() {
  const s = get();
  if (audio.currentTime > 3 || s.index <= 0) {
    audio.currentTime = 0;
    return;
  }
  finishCurrent(false);
  loadAt(s.index - 1);
}

export function playAt(index: number) {
  if (index === get().index) return toggle();
  finishCurrent(false);
  loadAt(index);
}

export function seek(seconds: number) {
  if (!Number.isFinite(seconds)) return;
  audio.currentTime = Math.max(0, seconds);
  set({ position: audio.currentTime });
}

export function setVolume(volume: number) {
  const v = Math.max(0, Math.min(1, volume));
  set({ volume: v });
  // The iPhone: the phone's own volume (its buttons move it too); see volume.ts.
  if (isIos) import('./volume.ts').then((m) => m.OniVolume.set({ value: v }).catch(() => {}));
  else {
    applyVolume();
    savePrefs();
  }
}

export function setNormalize(normalize: boolean) {
  set({ normalize });
  applyVolume();
  savePrefs();
}

/** Switch the sound quality; the playing track reloads in it, from the same spot. */
export function setQuality(quality: StreamQuality) {
  if (get().quality === quality) return;
  set({ quality });
  savePrefs();
  prefetched.clear();
  const t = current();
  if (!t || !audio.src) return;
  const at = audio.currentTime;
  const wasPlaying = !audio.paused;
  loadAt(get().index, wasPlaying).then(() => at > 1 && seek(at));
}

export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one'];
  set((s) => ({ repeat: order[(order.indexOf(s.repeat) + 1) % order.length] }));
  savePrefs();
}

export function toggleShuffle() {
  const s = get();
  if (s.source?.kind === 'wave' || !s.queue.length) return;
  const cur = s.queue[s.index];
  if (!s.shuffle) {
    unshuffled = s.queue;
    const rest = shuffleArray(s.queue.filter((_, i) => i !== s.index));
    set({ shuffle: true, queue: [cur, ...rest], index: 0 });
  } else {
    const original = unshuffled || s.queue;
    unshuffled = null;
    set({ shuffle: false, queue: original, index: Math.max(0, original.indexOf(cur)) });
  }
  prefetchNext();
}

export function playNext(t: Track) {
  set((s) => {
    const queue = [...s.queue];
    queue.splice(s.index + 1, 0, t);
    return { queue };
  });
  if (get().index < 0) loadAt(0);
  prefetchNext();
}

export function enqueue(t: Track) {
  set((s) => ({ queue: [...s.queue, t] }));
  if (get().index < 0) loadAt(0);
}

export function removeAt(i: number) {
  const s = get();
  if (i === s.index) return;
  const queue = s.queue.filter((_, j) => j !== i);
  set({ queue, index: i < s.index ? s.index - 1 : s.index });
}

export function dropFromQueue(trackId: string) {
  const s = get();
  const cur = s.queue[s.index];
  if (cur?.id === trackId) {
    next(true);
    return;
  }
  const queue = s.queue.filter((t) => t.id !== trackId);
  set({ queue, index: cur ? queue.indexOf(cur) : -1 });
}

function shuffleArray<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --------------------------------------------------------------- audio events

audio.addEventListener('playing', () => set({ playing: true, loading: false }));
audio.addEventListener('pause', () => set({ playing: false }));
audio.addEventListener('waiting', () => set({ loading: true }));
audio.addEventListener('canplay', () => set({ loading: false }));
audio.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(audio.duration)) set({ duration: audio.duration });
});
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime;
  const delta = t - lastTime;
  if (!audio.paused && delta > 0 && delta < 2) listened += delta;
  lastTime = t;
  set({ position: t });
  if ('setPositionState' in navigator.mediaSession && Number.isFinite(audio.duration)) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(t, audio.duration), playbackRate: 1 });
    } catch {
      /* ignore */
    }
  }
});
audio.addEventListener('ended', () => {
  if (get().repeat === 'one') {
    finishCurrent(true);
    audio.currentTime = 0;
    audio.play();
    return;
  }
  next(false);
});
audio.addEventListener('error', () => {
  if (!audio.src || !current()) return;
  // Signed stream URLs expire — retry once with a fresh one.
  const t = current()!;
  if (prefetched.has(t.id)) {
    prefetched.delete(t.id);
    const at = audio.currentTime;
    loadAt(get().index).then(() => at > 1 && seek(at));
    return;
  }
  set({ loading: false, error: tr().player.playbackError(t.title) });
});

// --------------------------------------------------------------- media keys

function updateMediaSession(t: Track) {
  if (!('mediaSession' in navigator)) return;
  const art = trackCover(t, 400);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title + (t.version ? ` (${t.version})` : ''),
    artist: artistNames(t),
    album: t.albums?.[0]?.title || '',
    artwork: art ? [{ src: art, sizes: '400x400', type: 'image/jpeg' }] : [],
  });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => toggle());
  ms.setActionHandler('pause', () => toggle());
  ms.setActionHandler('nexttrack', () => next(true));
  ms.setActionHandler('previoustrack', () => prev());
  ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime));
  // The iPhone lock screen showed -10 s / +10 s instead of previous / next: clear the seek
  // actions explicitly, so only the track ones are offered (not every browser knows them).
  for (const action of ['seekbackward', 'seekforward'] as const) {
    try {
      ms.setActionHandler(action, null);
    } catch {
      /* unsupported action */
    }
  }
}
// Back from the background (the iPhone may have held the page): the wave tops up its queue.
document.addEventListener('visibilitychange', () => !document.hidden && get().source?.kind === 'wave' && fillWave());

// That alone did not change the iPhone's lock screen: there a native plugin runs it (remote.ts).
if (isIos) import('./remote.ts').then((m) => m.connectRemote());
if (isIos) import('./volume.ts').then((m) => m.followSystemVolume((volume) => set({ volume })));

// -------------------------------------------------------------- persistence

function savePrefs() {
  const { volume, repeat, normalize, quality } = get();
  storage.setItem('player.prefs', JSON.stringify({ volume, repeat, normalize, quality }));
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const s = get();
    if (!s.queue.length) return;
    const from = Math.max(0, s.index - 20);
    storage.setItem(
      'player.session',
      JSON.stringify({ queue: s.queue.slice(from, from + 200), index: s.index - from, title: sourceTitle(s.source) }),
    );
  }, 1000);
}

/** Restore the last queue (paused) so the app opens where you left off. */
export function restoreSession() {
  try {
    const raw = storage.getItem('player.session');
    if (!raw) return;
    const { queue, index, title } = JSON.parse(raw);
    if (!Array.isArray(queue) || !queue[index]) return;
    set({ queue, index, source: { kind: 'list', title }, duration: (queue[index].durationMs || 0) / 1000 });
    updateMediaSession(queue[index]);
  } catch {
    /* ignore */
  }
}

