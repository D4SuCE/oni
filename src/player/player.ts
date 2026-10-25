// Playback: one <audio> element, a queue, wave integration, listening history
// and OS media controls (Windows SMTC / iOS lock screen via Media Session).

import { create } from 'zustand';
import type { Track } from '../api/types.ts';
import { api, loadJson, storage, transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { artistNames, heardSeconds, NetworkError, trackCover, type StreamQuality } from '../api/yandex.ts';
import { DEFAULT_TUNING, WaveEngine, waveSeeds, type Diversity, type Language, type Mood, type WaveStats, type WaveTuning } from '../wave/engine.ts';
import { HEARD_SECONDS, ListenHistory } from '../wave/history.ts';
import { PlayLog } from './playLog.ts';
import { playOutcome, RecsFeedback } from '../recs/feedback.ts';
import type { Mix } from '../recs/index.ts';
import { RecentPlays } from './recent.ts';
import { levellingGain } from './loudness.ts';
import { OfflineLibrary } from './offline.ts';
import { PlayStats, type Origin } from './stats.ts';
import { isIos } from '../ui/platform.ts';
import { audio } from './audio.ts';
import { audioExt, OniPlayer, type NativeAudio } from './nativeAudio.ts';
import type { CommandName } from '../sync/playing.ts';

export type Repeat = 'off' | 'all' | 'one';
/** A wave without a station is My Wave; with one it is a radio seeded by a track, artist, album or playlist. */
/** Where a list came from, reported to Yandex with each play so its history groups plays right. */
export interface PlayContext {
  /** "<uid>:<kind>" */
  playlist?: string;
  album?: number | string;
}
/**
 * What a list is, so its title is put in the interface language when it shows: the language may
 * change while it plays (the user switched to English, and the banner still said "Открытия недели").
 * Lists named by Yandex or the user (playlists, albums, artists) need none: their names stay.
 */
export type ListLabel =
  | { key: 'liked' | 'downloads' | 'history' | 'chart' }
  /** With what was picked in "Tune" at the time (History says "My Wave · Rock · Upbeat": the user, 25.10.2026). */
  | { key: 'myWave'; picks?: WavePicks }
  | { key: 'search' | 'similar'; arg: string }
  | { key: 'mix'; mix: MixName }
  /** A station: `of` names what it plays from when that has a label ("Radio: Liked songs"). */
  | { key: 'radio'; title: string; of?: ListLabel };
/** What a mix's title is built from (components/Mixes.tsx, mixTitle). */
export type MixName = Pick<Mix, 'kind' | 'genre' | 'seedArtist' | 'slot' | 'slotStart' | 'builtAt'>;

export type Source =
  | { kind: 'wave'; station?: { seed: string; title: string; label?: ListLabel } }
  /**
   * `suggested`: ids Smart Shuffle added to the list (shown with ✦ in the queue);
   * `origin`: which recommendation it came from, for the stats in Settings.
   */
  | { kind: 'list'; title: string; from?: PlayContext; suggested?: string[]; origin?: Origin; list?: string; label?: ListLabel };

export interface PlayExtra {
  suggested?: string[];
  origin?: Origin;
  /** Which list this is, where `from` does not say (a mix, Downloads): its page shows it playing. */
  list?: string;
  label?: ListLabel;
}

/** The list playing, as its page names it: "playlist:<uid>:<kind>", "album:<id>", "mix:<id>", … */
export function listKeyOf(source: Source | null) {
  if (source?.kind !== 'list') return undefined;
  if (source.list) return source.list;
  if (source.from?.playlist) return `playlist:${source.from.playlist}`;
  if (source.from?.album !== undefined) return `album:${source.from.album}`;
  return undefined;
}

export function sourceTitle(source: Source | null) {
  if (source?.kind === 'list') return source.title;
  return source?.station ? tr().common.radioOf(source.station.title) : tr().common.myWave;
}

/** The label of what plays (components/SourceTitle.ts puts it in words), for History's runs too. */
export function labelOf(source: Source | null): ListLabel | undefined {
  if (source?.kind === 'list') return source.label;
  if (!source?.station) return { key: 'myWave', picks: wavePicks(get().tuning) };
  return { key: 'radio', title: source.station.title, of: source.station.label };
}

/** My Wave's Yandex-side picks, as keys (put in words when shown); the activity or genre by its name. */
export interface WavePicks {
  context?: string;
  diversity?: Diversity;
  mood?: Mood;
  language?: Language;
}

function wavePicks(t: WaveTuning): WavePicks | undefined {
  const picks: WavePicks = {};
  if (t.context?.name) picks.context = t.context.name;
  if (t.diversity !== 'default') picks.diversity = t.diversity;
  if (t.mood !== 'all') picks.mood = t.mood;
  if (t.language !== 'any') picks.language = t.language;
  return Object.keys(picks).length ? picks : undefined;
}

export const isMyWave = (source: Source | null) => source?.kind === 'wave' && !source.station;

interface Prefs {
  volume: number;
  repeat: Repeat;
  normalize: boolean;
  quality: StreamQuality;
  /** Seconds one track flows into the next (0: off). */
  crossfade: number;
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
  /** The sleep timer: when the music stops (ms epoch), or at the end of the track playing. */
  sleep: { until: number | null; afterTrack: boolean };
}

const prefs = loadJson<Prefs>('player.prefs', { volume: 0.8, repeat: 'off', normalize: true, quality: 'lossless', crossfade: 0 });

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
  sleep: { until: null, afterTrack: false },
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
        fetchCover: async (t) => {
          const url = trackCover(t, 400);
          return url ? transport.fetchBytes!(url) : null;
        },
        fetchLyrics: (t) => import('./lyrics.ts').then((m) => m.lyricsOf(t)),
      })
    : null;
// The room rules (Settings → Downloads) once the files are counted; the track playing is kept.
offline?.reconcile().then(() => offline!.sweep()).catch(() => {});
if (offline) offline.pin = (id) => String(current()?.id) === id;

/** No network (set by the app store): only downloaded tracks can play, the rest are skipped at once. */
let offlineMode = false;
export const setOfflineMode = (on: boolean) => {
  offlineMode = on;
};

/** Tells the app store the network is gone (it shows so and waits for it to come back). */
let networkLost: () => void = () => {};
export const onNetworkLost = (fn: () => void) => {
  networkLost = fn;
};
/** A request that never reached Yandex (no network, a timeout), not one Yandex answered with an error. */
/** The network is gone: a request that never reached Yandex, or the system says so. Any other
 * error (a track that would not start: a stale address, a file it could not read) is not: taking
 * it for one put the app offline, and it ran through every track not downloaded in a blink (a
 * friend of the user's saw tracks switch by themselves, fast). */
const isNetworkError = (e: unknown) => e instanceof NetworkError || (typeof navigator !== 'undefined' && navigator.onLine === false);
/** Tracks in a row that would not start: at three the downloads stand in rather than run on. */
let failedInRow = 0;
/** Where that run of failures began: the list comes back there (none of them was heard). */
let failedFrom = 0;
const MAX_FAILED_IN_ROW = 3;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 80);

/**
 * My Wave (or a station) whose network went away mid-play, as in Yandex's app: the downloaded
 * tracks play shuffled meanwhile, and the wave comes back with the network, at the end of the
 * track playing then (not cut off in the middle).
 */
let waveToResume: (Source & { kind: 'wave' }) | null = null;
/** A list whose tracks would not start (Yandex refusing), to come back to at that track. */
let listToResume: { source: Source; queue: Track[]; index: number } | null = null;
/** The tracks Yandex refused and those after them: asked for again now and then, the first that
 * comes is where the music comes back (a track broken for good is passed over, the user asked:
 * waiting for it alone, the downloads would play for ever). Until one comes, no coming back. */
let refusedTrack: Track | null = null;
let probeTracks: Track[] = [];
/** Stopped by itself to wait (nothing downloaded to stand in): the only pause that ends by itself.
 * A pause of the user's stays one (the music had started again behind it). */
let waitingForYandex = false;
let probing: ReturnType<typeof setInterval> | null = null;
const PROBE_MS = transport.testMode ? 3000 : 20_000;

function stopProbe() {
  if (probing) clearInterval(probing);
  probing = null;
}

/** The user picked something else: what stood in for is not come back to. */
function forgetResume() {
  waveToResume = null;
  listToResume = null;
  refusedTrack = null;
  probeTracks = [];
  waitingForYandex = false;
  stopProbe();
}

const canResume = () => Boolean(waveToResume || listToResume) && !offlineMode && !refusedTrack;

/** Back to the wave or the list the downloads stood in for (`ended`: the downloaded track ended). */
function resumeNow(ended = false) {
  if (waveToResume) {
    const wave = waveToResume;
    waveToResume = null;
    return startWave(wave);
  }
  if (listToResume) {
    const r = listToResume;
    listToResume = null;
    finishCurrent(ended);
    engine = null;
    unshuffled = null;
    set({ queue: r.queue, source: r.source, shuffle: false, waveStats: null });
    return loadAt(r.index);
  }
}

/** Asks Yandex for the refused track now and then; once it answers, the music may come back. */
function probe() {
  stopProbe();
  probing = setInterval(async () => {
    if (!refusedTrack) return stopProbe();
    if (offlineMode) return;
    let found = -1;
    for (let k = 0; k < probeTracks.length && found < 0; k++) {
      const t = probeTracks[k];
      try {
        const s = await api.stream(String(t.id), get().quality);
        prefetched.set(t.id, { url: s.url, at: Date.now(), codec: s.codec, bitrate: s.bitrate });
        found = k;
      } catch {
        /* this one not yet (or never): the next */
      }
    }
    if (found < 0 || !refusedTrack) return;
    // The list comes back at the first track Yandex gives (those before it passed over).
    if (listToResume) listToResume = { ...listToResume, index: listToResume.index + found };
    refusedTrack = null;
    probeTracks = [];
    stopProbe();
    // Nothing stood in (no downloads): the music goes on by itself; else at the end of the track.
    if (waitingForYandex && audio.paused) {
      waitingForYandex = false;
      void resumeNow();
    }
  }, PROBE_MS);
}

/**
 * Tracks of the wave or the list would not start, several in a row (Yandex refusing, not the
 * network): the downloads stand in, as with no network (the user's wish), the list's own first,
 * from after the track that failed; and it comes back once Yandex gives that track again. With
 * nothing downloaded the player waits, and goes on by itself then.
 */
function standIn(t: Track, index: number, e: unknown) {
  const s = get();
  refusedTrack = t;
  // It and the four after it (the wave's too: any track it gives means Yandex gives again).
  probeTracks = [t, ...s.queue.slice(index + 1, index + 5)];
  if (s.source?.kind === 'wave') waveToResume = s.source;
  else if (s.source) listToResume = { source: s.source, queue: s.queue, index };
  probe();
  const saved = offline?.entries().map((x) => x.track) ?? [];
  const has = new Set(saved.map((x) => String(x.id)));
  const own = s.source?.kind === 'list' ? [...s.queue.slice(index + 1), ...s.queue.slice(0, index)].filter((x) => has.has(String(x.id))) : [];
  const why = errorMessage(e);
  if (!own.length && !saved.length) {
    waitingForYandex = true;
    audio.pause();
    set({ loading: false, playing: false, error: tr().player.waitingForYandex(why) });
    return;
  }
  void startList(own.length ? own : shuffleArray(saved), 0, tr().nav.downloads, undefined, { list: 'downloads' }).then(() => set({ error: tr().player.standIn(why) }));
}

function fallBackToDownloads() {
  const source = get().source;
  const saved = offline?.entries().map((e) => e.track) ?? [];
  if (source?.kind !== 'wave' || !saved.length) return false;
  waveToResume = source;
  networkLost();
  startList(shuffleArray(saved), 0, tr().nav.downloads, undefined, { list: 'downloads' });
  return true;
}

/** The object URL of the downloaded track playing now; freed when the next one loads. */
let localUrl: string | null = null;
function setLocalAudio(blob: Blob | null) {
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = blob ? URL.createObjectURL(blob) : null;
  return localUrl;
}
export const recentPlays = new RecentPlays(storage);
/** Every play heard, with its date and length: "Recap" (History). Filled once from the recent plays. */
export const playLog = new PlayLog(storage);
playLog.seed(recentPlays.list());
// The same song under another id counts as heard for "Only new" from the start, not only for new plays.
history.learnSongs(playLog.cards());
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

/** "Skipped" (recs/feedback.ts) leaves the wave too, when "Hide what I skip" is on (the user's choice). */
const leftOut = (t: Track) => recsFeedback.isSkipped(t.id, Date.now());

let isLiked: (id: string) => boolean = () => false;
/** The library's likes (store.ts): a liked track's skips never leave it out ("Skipped"). */
export function setLikedCheck(fn: (id: string) => boolean) {
  isLiked = fn;
}

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

/** The audio element can cross from one track into the next (dualAudio.ts; the iPhone's native player). */
type Crossfading = { crossfade(url: string, ms: number, ended?: () => void): Promise<void> };
const canCrossfade = () => typeof (audio as unknown as Partial<Crossfading>).crossfade === 'function';
/** This track's crossfade has begun (it is set off once, near its end). */
let crossStarted = false;
/** The crossfade's next track is still loading (a slow address or file): the old track plays on
 * meanwhile, and its clock and its end are not the next one's — its end would skip the next. */
let crossLoading = false;

/** `fade`: seconds to cross into this track from the one playing (the crossfade setting). */
async function loadAt(index: number, autoplay = true, fade = 0) {
  const t = get().queue[index];
  if (!t) return;
  const seq = ++loadSeq;
  crossStarted = false;
  stale = false;
  // Taken over from another device: it goes on from where it was there.
  const resume = resumeAt?.id === t.id ? resumeAt.seconds : 0;
  resumeAt = null;
  set({ index, loading: true, position: 0, duration: (t.durationMs || 0) / 1000, error: null });
  opening = seq;
  listened = 0;
  newPlay();
  lastTime = 0;
  updateMediaSession(t);
  try {
    if (offlineMode && !offline?.has(t.id)) {
      // No network: straight to the next downloaded track, not through each one that is not.
      const s = get();
      const ahead = s.queue.findIndex((x, i) => i > index && offline?.has(x.id));
      if (ahead >= 0 && s.source?.kind !== 'wave') return void loadAt(ahead, autoplay);
      throw new Error('not downloaded and no network');
    }
    // A downloaded copy plays first: it needs no network and no traffic. The iPhone's player opens
    // the sealed file itself with the key (decrypting it here and sending it over as text froze
    // the page on every downloaded track).
    const saved = offline?.entry(t.id);
    // Played now: the last to go when room is made.
    if (saved) offline!.touch(t.id);
    const sealedKey = isIos && saved ? await offline!.rawKey() : null;
    const local = saved && !sealedKey ? await offline!.open(t.id).catch(() => null) : null;
    const stream = saved && (sealedKey || local) ? { url: '', codec: saved.codec, bitrate: saved.bitrate } : await streamUrl(t);
    if (seq !== loadSeq) return;
    // Paused while it loaded: it is made ready, not started.
    if (pausedLoad === seq) {
      autoplay = false;
      heldLoad = seq;
    }
    if (isIos) {
      // The native player is told which track it opens and which files to keep (this and the next).
      const nextId = get().queue[index + 1]?.id;
      // Its length too: a track played while it still arrives (fast start) has no length of its own yet.
      (audio as unknown as NativeAudio).next = { id: String(t.id), ext: audioExt(stream.codec), keep: [String(t.id), ...(nextId ? [String(nextId)] : [])], key: sealedKey ?? undefined, duration: (t.durationMs || 0) / 1000 || undefined };
    }
    if (fade > 0 && autoplay && !audio.paused && canCrossfade()) {
      // The next one starts while this one fades out; this one's downloaded copy is freed once silent.
      const old = localUrl;
      localUrl = local ? URL.createObjectURL(local.blob) : null;
      set({ stream: { codec: stream.codec, bitrate: stream.bitrate } });
      await (audio as unknown as Crossfading).crossfade(sealedKey ? `oni-sealed:${t.id}` : (localUrl ?? stream.url), fade * 1000, () => {
        if (old) URL.revokeObjectURL(old);
      });
      // After the crossing has begun: this track's level (normalization) leads the fade, not the old one's.
      applyVolume();
    } else {
      audio.src = sealedKey ? `oni-sealed:${t.id}` : local ? setLocalAudio(local.blob)! : stream.url;
      if (!local) setLocalAudio(null);
      set({ stream: { codec: stream.codec, bitrate: stream.bitrate } });
      applyVolume();
      if (resume > 1) {
        audio.currentTime = resume;
        lastTime = resume;
        set({ position: resume });
      }
      if (autoplay) await audio.play();
    }
    if (opening === seq) opening = 0;
    if (get().source?.kind === 'wave') engine?.feedback('trackStarted', t);
    prefetchNext();
    if (get().source?.kind === 'wave') fillWave();
  } catch (e: any) {
    if (opening === seq) opening = 0;
    if (seq !== loadSeq || e?.name === 'AbortError') return;
    // The wave lost the network: the downloads play instead of skipping through its queue.
    if (get().source?.kind === 'wave' && (offlineMode || isNetworkError(e)) && fallBackToDownloads()) return;
    // A list lost it: the app goes offline, so what is not downloaded is passed over at once.
    if (!offlineMode && isNetworkError(e)) networkLost();
    // Several in a row would not start (Yandex refusing, say): the downloads stand in until it
    // gives them again; the downloads themselves failing, it stops and says why.
    if (!offlineMode && failedInRow === 0) failedFrom = index;
    if (!offlineMode && ++failedInRow >= MAX_FAILED_IN_ROW) {
      failedInRow = 0;
      if (get().source?.kind === 'list' && (get().source as { list?: string }).list === 'downloads') {
        audio.pause();
        set({ loading: false, playing: false, error: tr().player.cantPlayMany(errorMessage(e)) });
        return;
      }
      const from = Math.min(failedFrom, index);
      return standIn(get().queue[from] ?? t, from, e);
    }
    set({ loading: false, error: tr().player.cantPlay(t.title) });
    setTimeout(() => seq === loadSeq && next(false), offlineMode ? 0 : 1500);
  }
  persistSoon();
}

/** What of the current play is written already: it is written as it plays, not only when the track
 * changes (the user: a track heard almost to its end, then Oni closed, never reached History). */
let written = { recent: false, heard: false, length: 0 };
/** Seconds between updates of a counted play's length in the log (Recap's minutes). */
const RELOG = 30;

function addRecent(t: Track) {
  const source = get().source;
  recentPlays.add({
    track: t,
    at: play.startedAt.getTime(),
    source: sourceTitle(source),
    label: labelOf(source),
    from: source?.kind === 'list' ? source.from : undefined,
  });
  useRecent.setState((s) => ({ version: s.version + 1 }));
}

/** In History after 5 s, counted as heard (repeat filter, Recap) after 30 s, its length kept up. */
function writeAsItPlays() {
  const t = current();
  if (!t) return;
  if (!written.recent && listened >= 5) {
    written.recent = true;
    addRecent(t);
  }
  if (!written.heard && listened >= HEARD_SECONDS) {
    written.heard = true;
    history.record(t, listened, false);
  } else if (!written.heard || listened - written.length < RELOG) return;
  written.length = listened;
  playLog.record(t, play.startedAt.getTime(), listened);
}

/** A play starts: its own report to Yandex and its own entries in History and the log. */
function newPlay() {
  play = { id: crypto.randomUUID(), startedAt: new Date() };
  written = { recent: false, heard: false, length: 0 };
}

/** Called whenever we leave the current track, before switching. */
function finishCurrent(ended: boolean) {
  const t = current();
  if (!t || (listened < 1 && !ended)) return;
  if (!written.heard) history.record(t, listened, ended);
  if (ended || listened >= HEARD_SECONDS) playLog.record(t, play.startedAt.getTime(), listened);
  stats.record(originOf(t), listened, (t.durationMs || 0) / 1000, ended);
  // A skip says something against a track only where it was offered (the wave, radios, mixes):
  // not in a list of one's own choosing, nor for a liked track.
  recsFeedback.recordPlay(t, playOutcome(listened, (t.durationMs || 0) / 1000, ended), Date.now(), originOf(t) === 'list' || isLiked(String(t.id)));
  reportPlay(t, ended);
  if (!written.recent && (ended || listened >= 5)) addRecent(t);
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
  // Tests must not touch the history. The wave's plays are reported too: its session feedback
  // alone puts nothing into the account's history (the user: none for a night of My Wave).
  if (!source || transport.testMode || listened < 1) return;
  api
    .reportPlay({
      track: t,
      playId: play.id,
      startedAt: play.startedAt,
      playedSeconds: heardSeconds(listened, ended, (t.durationMs || 0) / 1000, audio.currentTime),
      endSeconds: ended ? (t.durationMs || 0) / 1000 : audio.currentTime,
      ...(source.kind === 'list' ? source.from : { wave: engine?.radio }),
    })
    .catch((e) => console.warn('play report failed', e));
}

// ---------------------------------------------------------------------- wave

/** The fill in progress, per engine: a new wave (re-tuned, restarted) never waits on the old
 * one's request, which could hang and leave "next" with nothing to play. */
let filling: { engine: WaveEngine; done: Promise<void>; at: number; id: number } | null = null;
let fills = 0;
/** The last fill ended without reaching Yandex. */
let fillLostNetwork = false;
/** A wave request that has not answered by then is given up (the phone in the background could
 * hold one for good, and "next" waited on it even after the screen was unlocked). */
const FILL_TIMEOUT = 15_000;
/** Tracks kept ready ahead, so a few quick skips never wait on Yandex (the user: three or four
 * and "next" did nothing); more on the iPhone, where the page may be held in the background. */
const WAVE_AHEAD = isIos ? 5 : 4;

const withTimeout = <T,>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('wave request timed out')), FILL_TIMEOUT))]);

function fillWave(min = WAVE_AHEAD): Promise<void> {
  const mine = engine;
  if (!mine) return Promise.resolve();
  if (filling?.engine === mine && Date.now() - filling.at < FILL_TIMEOUT) return filling.done;
  const id = ++fills;
  // Marked under way before it starts. A fill with nothing to do ends at once, before the line
  // below it ran: marked after that, it stayed "under way" for 15 s, and every "next" meanwhile
  // waited on it for nothing (the user: after a few quick skips "next" did nothing).
  const entry = { engine: mine, done: Promise.resolve(), at: Date.now(), id };
  filling = entry;
  entry.done = (async () => {
    fillLostNetwork = false;
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
      fillLostNetwork = isNetworkError(e);
    } finally {
      if (filling?.id === id) filling = null;
    }
  })();
  return entry.done;
}

export async function playWave(tuning?: Partial<WaveTuning>) {
  forgetResume();
  if (tuning) saveTuning(tuning);
  await startWave({ kind: 'wave' });
}

/** Endless radio from one seed, e.g. `track:123`, `artist:45`, `album:67`, `playlist:<uid>:<kind>`. Repeat filters apply. */
export async function playRadio(seed: string, title: string, label?: ListLabel) {
  forgetResume();
  clearWavePicks();
  await startWave({ kind: 'wave', station: { seed, title, label } });
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
  elsewhere?.leave();
  const start = ++waveStarts;
  finishCurrent(false);
  // The old track plays on until the new wave's first one is ready (the user's choice).
  const mine = new WaveEngine(waveApi, history, get().tuning, (id) => isDisliked(id), source.station ? [source.station.seed] : null);
  mine.isSkipped = leftOut;
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
    if (start !== waveStarts) return;
    // Started with no network: the downloads, until it is back.
    if ((offlineMode || isNetworkError(e)) && fallBackToDownloads()) return;
    set({ error: tr().player.waveFailed(String(e?.message || e)) });
  } finally {
    if (start === waveStarts) set({ waveBusy: false });
  }
}

/** My Wave without Yandex-side settings (activity, character, mood, language); the repeat filters are the user's own and stay. */
export const PLAIN_WAVE = { context: null, diversity: 'default', mood: 'all', language: 'any' } as const;
const YANDEX_PICKS = Object.keys(PLAIN_WAVE) as (keyof WaveTuning)[];

/** Something else than My Wave plays (a list, a station radio): its settings are let go, so
 * "Tune" does not show "sad" picked over a recap that plays (the user), and a later My Wave
 * starts plain, as the "My Wave" link has always started it. */
function clearWavePicks() {
  saveTuning(PLAIN_WAVE);
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
  // From a list or a station even a pick of what is shown ("Any") does: it is a pick of My Wave.
  const pick = YANDEX_PICKS.some((k) => k in patch);
  if (seedsChanged || (pick && !isMyWave(source))) await startWave({ kind: 'wave' });
}

export function waveFeedback(type: 'like' | 'dislike', t: Track) {
  if (get().source?.kind === 'wave') engine?.feedback(type, t);
}

// ------------------------------------------------------------------ controls

export async function playTracks(tracks: Track[], start = 0, title = tr().common.list, from?: PlayContext, extra: PlayExtra = {}) {
  // Picked by the user: the wave (or list) the downloads stood in for does not come back over it.
  forgetResume();
  clearWavePicks();
  await startList(tracks, start, title, from, extra);
}

/** Playable now: available, and with no network downloaded. */
const canPlay = (t: Track) => t.available !== false && (!offlineMode || Boolean(offline?.has(t.id)));

/** A list still coming in parts (a big playlist, ui/listLoader.ts): its later tracks join the
 * queue as they come, if it is what plays, in its order (not shuffled). */
export function extendList(list: string, tracks: Track[]) {
  const s = get();
  if (listKeyOf(s.source) !== list || s.shuffle) return;
  const queue = tracks.filter(canPlay);
  if (queue.length <= s.queue.length) return;
  const cur = s.queue[s.index];
  const index = cur ? queue.findIndex((t) => String(t.id) === String(cur.id)) : s.index;
  if (index < 0) return;
  set({ queue, index });
  prefetchNext();
}

async function startList(tracks: Track[], start: number, title: string, from?: PlayContext, extra: PlayExtra = {}) {
  elsewhere?.leave();
  // With no network only the downloaded ones, in the list's order; a pick that is not downloaded
  // starts the next one that is.
  const playable = tracks.filter(canPlay);
  if (!playable.length) {
    set({ error: offlineMode ? tr().downloads.nothingHere : tr().player.cantPlay(title) });
    return;
  }
  finishCurrent(false);
  engine = null;
  const startTrack = tracks.slice(start).find(canPlay);
  const index = Math.max(0, startTrack ? playable.indexOf(startTrack) : 0);
  unshuffled = null;
  set({ queue: playable, source: { kind: 'list', title, from, ...extra }, shuffle: false, waveStats: null });
  await loadAt(index);
}

export async function playShuffled(tracks: Track[], title = tr().common.list, from?: PlayContext, extra: PlayExtra = {}) {
  const playable = tracks.filter((t) => t.available !== false);
  await playTracks(shuffleArray(playable), 0, title, from, extra);
}

/** The load (its loadSeq) that Pause was pressed during: it does not start when ready; and the
 * load that, so paused, has its track in place already (Play then plays it). */
let pausedLoad = 0;
let heldLoad = 0;
/** The load still opening its track (its loadSeq; 0 once the track is in place). "Loading" alone
 * is also a playing track's wait for more data, where Pause and Play act on the audio as ever. */
let opening = 0;

export function toggle() {
  if (elsewhere) return elsewhere.send('toggle', []);
  if (!current()) return;
  // The user's own play or pause: no longer a wait that ends by itself.
  waitingForYandex = false;
  const s = get();
  // Just opened, nothing has loaded yet (both 0): the restored track is not "opening" — taken for
  // one, Play only unpaused an empty player and stayed silent (the user, after a restart).
  const isOpening = opening !== 0 && opening === loadSeq;
  // A track still loading to play shows Pause: pressed then, it pauses. Going by the audio (not
  // playing yet) it started the track instead (found by the e2e run; a lock screen's pause right
  // after "next" too).
  if (isOpening && s.playing) {
    pausedLoad = loadSeq;
    audio.pause();
    set({ playing: false });
    return;
  }
  // Paused while loading and pressed again before it is ready: it plays as soon as it is.
  if (isOpening && pausedLoad === loadSeq) {
    pausedLoad = 0;
    if (heldLoad === loadSeq) audio.play().catch(() => {});
    else set({ playing: true });
    return;
  }
  if (audio.paused) {
    if (!audio.src || stale) loadAt(get().index);
    else audio.play().catch(() => {});
  } else audio.pause();
}

/** `fade`: the crossfade's seconds, when the track playing flows into the next. */
export async function next(user = true, fade = 0) {
  if (elsewhere) return void (user && elsewhere.send('next', []));
  const s = get();
  if (!s.queue.length) return;
  // The network is back (or Yandex gives the tracks again): the wave or list the downloads stood
  // in for plays again, from this track's end on.
  if (canResume()) return resumeNow(!user);
  finishCurrent(!user);
  if (s.index + 1 < s.queue.length) return loadAt(s.index + 1, true, fade);
  if (s.source?.kind === 'wave') {
    // Skipped past what was ready: the next one is on its way, and the player says so.
    set({ loading: true });
    await fillWave(1);
    if (get().index + 1 < get().queue.length) return loadAt(get().index + 1, true, fade);
    set({ loading: false });
    // Nothing more came: with no network the downloads play instead.
    if (offlineMode || fillLostNetwork) fallBackToDownloads();
    return;
  }
  if (s.repeat === 'all') return loadAt(0, true, fade);
  audio.pause();
}

export function prev() {
  if (elsewhere) return elsewhere.send('prev', []);
  const s = get();
  if (stale) return seek(0);
  if (audio.currentTime > 3 || s.index <= 0) {
    audio.currentTime = 0;
    return;
  }
  finishCurrent(false);
  loadAt(s.index - 1);
}

export function playAt(index: number) {
  if (elsewhere) return elsewhere.send('playAt', [index]);
  if (index === get().index) return toggle();
  finishCurrent(false);
  loadAt(index);
}

export function seek(seconds: number) {
  if (!Number.isFinite(seconds)) return;
  if (elsewhere) return elsewhere.send('seek', [Math.max(0, seconds)]);
  // Taken over and not started yet: it starts there.
  if (stale && current()) {
    resumeAt = { id: current()!.id, seconds: Math.max(0, seconds) };
    return void set({ position: Math.max(0, seconds) });
  }
  audio.currentTime = Math.max(0, seconds);
  set({ position: audio.currentTime });
}

export function setVolume(volume: number) {
  const v = Math.max(0, Math.min(1, volume));
  set({ volume: v });
  // A remote: the volume of the device controlled (this one's own stays as it is).
  if (elsewhere) return elsewhere.send('volume', [v]);
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

/** The crossfade's length in seconds (0: off). */
export function setCrossfade(seconds: number) {
  set({ crossfade: Math.max(0, Math.min(12, Math.round(seconds))) });
  savePrefs();
}

export function cycleRepeat() {
  if (elsewhere) return elsewhere.send('cycleRepeat', []);
  const order: Repeat[] = ['off', 'all', 'one'];
  set((s) => ({ repeat: order[(order.indexOf(s.repeat) + 1) % order.length] }));
  savePrefs();
}

export function toggleShuffle() {
  if (elsewhere) return elsewhere.send('toggleShuffle', []);
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
  if (elsewhere) return elsewhere.send('playNext', [t]);
  set((s) => {
    const queue = [...s.queue];
    queue.splice(s.index + 1, 0, t);
    return { queue };
  });
  if (get().index < 0) loadAt(0);
  prefetchNext();
}

export function enqueue(t: Track) {
  if (elsewhere) return elsewhere.send('enqueue', [t]);
  set((s) => ({ queue: [...s.queue, t] }));
  if (get().index < 0) loadAt(0);
}

/** A queued track to another place (dragged in the queue); the one playing stays playing. */
export function moveInQueue(from: number, to: number) {
  if (elsewhere) return elsewhere.send('moveInQueue', [from, to]);
  const s = get();
  if (from === s.index || to <= s.index || from <= s.index || from >= s.queue.length || to >= s.queue.length) return;
  const queue = [...s.queue];
  const [t] = queue.splice(from, 1);
  queue.splice(to, 0, t);
  set({ queue });
  prefetchNext();
}

export function removeAt(i: number) {
  if (elsewhere) return elsewhere.send('removeAt', [i]);
  const s = get();
  if (i === s.index) return;
  const queue = s.queue.filter((_, j) => j !== i);
  set({ queue, index: i < s.index ? s.index - 1 : s.index });
}

export function dropFromQueue(trackId: string) {
  const s = get();
  const cur = s.queue[s.index];
  if (elsewhere && cur?.id !== trackId) {
    const i = s.queue.findIndex((t) => t.id === trackId);
    return void (i >= 0 && removeAt(i));
  }
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

// ---------------------------------------------------------------- sleep timer

let sleepTimer: ReturnType<typeof setTimeout> | null = null;

/** The sleep timer: in so many minutes, at the end of this track, or off (null). */
export function setSleep(when: number | 'track' | null) {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  if (typeof when === 'number') {
    const until = Date.now() + when * 60_000;
    sleepTimer = setTimeout(() => void fallAsleep(), until - Date.now());
    set({ sleep: { until, afterTrack: false } });
  } else set({ sleep: { until: null, afterTrack: when === 'track' } });
}

/** The music fades out over a few seconds and pauses (not cut off mid-note); the volume comes back for next time. */
async function fallAsleep() {
  sleepTimer = null;
  set({ sleep: { until: null, afterTrack: false } });
  if (audio.paused) return;
  const steps = 16;
  const gain = (k: number) => {
    if (isIos) OniPlayer.setGain({ value: Math.min(1, (get().normalize ? levellingGain(current()?.r128?.i) : 1) * k) }).catch(() => {});
    else audio.volume = Math.max(0, Math.min(1, get().volume * (get().normalize ? levellingGain(current()?.r128?.i) : 1) * k));
  };
  for (let i = steps - 1; i >= 0; i--) {
    gain(i / steps);
    await new Promise((r) => setTimeout(r, 250));
  }
  audio.pause();
  applyVolume();
}

// --------------------------------------------------------------- audio events

audio.addEventListener('playing', () => {
  failedInRow = 0;
  set({ playing: true, loading: false });
});
// While this device is another's remote, its own audio's last events (the pause that stopped it)
// must not show over what plays there.
audio.addEventListener('pause', () => !elsewhere && set({ playing: false }));
audio.addEventListener('waiting', () => !elsewhere && set({ loading: true }));
audio.addEventListener('canplay', () => !elsewhere && set({ loading: false }));
audio.addEventListener('loadedmetadata', () => {
  if (elsewhere) return;
  if (Number.isFinite(audio.duration)) set({ duration: audio.duration });
});
audio.addEventListener('timeupdate', () => {
  if (crossLoading || elsewhere) return;
  const t = audio.currentTime;
  const delta = t - lastTime;
  if (!audio.paused && delta > 0 && delta < 2) {
    listened += delta;
    writeAsItPlays();
  }
  lastTime = t;
  set({ position: t });
  // Crossfade: the next track begins this many seconds before this one ends (not on repeat-one,
  // not when the sleep timer stops after this track, not for tracks too short for it).
  const fade = get().crossfade;
  const d = audio.duration;
  if (fade > 0 && !crossStarted && !audio.paused && canCrossfade() && Number.isFinite(d) && d > fade * 3 && d - t <= fade && get().repeat !== 'one' && !get().sleep.afterTrack) {
    crossStarted = true;
    crossLoading = true;
    void next(false, fade).finally(() => (crossLoading = false));
  }
  if ('setPositionState' in navigator.mediaSession && Number.isFinite(audio.duration)) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(t, audio.duration), playbackRate: 1 });
    } catch {
      /* ignore */
    }
  }
});
audio.addEventListener('ended', () => {
  // The old track of a crossfade ended before the next one loaded: that one plays when it has.
  if (crossLoading) return;
  // "At the end of this track": it ends, and nothing comes after it.
  if (get().sleep.afterTrack) {
    finishCurrent(true);
    set({ sleep: { until: null, afterTrack: false } });
    return;
  }
  if (get().repeat === 'one') {
    finishCurrent(true);
    newPlay(); // the same track again is another play
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
// A remote shows the other device's volume instead.
if (isIos) import('./volume.ts').then((m) => m.followSystemVolume((volume) => !elsewhere && set({ volume })));

// -------------------------------------------------------------- persistence

function savePrefs() {
  const { volume, repeat, normalize, quality, crossfade } = get();
  storage.setItem('player.prefs', JSON.stringify({ volume, repeat, normalize, quality, crossfade }));
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const s = get();
    if (!s.queue.length || elsewhere) return;
    const from = Math.max(0, s.index - 20);
    // The wave (My Wave or a station) is kept as such: restored as a plain list it ran dry after
    // the few tracks it had ahead (the user).
    const wave = s.source?.kind === 'wave' ? s.source : undefined;
    storage.setItem(
      'player.session',
      JSON.stringify({ queue: s.queue.slice(from, from + 200), index: s.index - from, title: sourceTitle(s.source), label: labelOf(s.source), wave }),
    );
  }, 1000);
}

/** The account is ready (the app store calls it): a wave restored from the last run tops itself
 * up now, not only once play is pressed, so the first skips find tracks waiting. */
export function warmWave() {
  if (get().source?.kind === 'wave' && engine) fillWave();
}

/** A queue put in place, paused, its track not loaded yet (Play loads it): the last run's, or
 * another device's. A wave goes on from where it was: a new session with Yandex starts with the next fill. */
function placeSession(queue: Track[], index: number, title: string, label?: ListLabel, wave?: Source) {
  if (wave?.kind === 'wave') {
    engine = new WaveEngine(waveApi, history, get().tuning, (id) => isDisliked(id), wave.station ? [wave.station.seed] : null);
    engine.isSkipped = leftOut;
    set({ queue, index, source: wave, duration: (queue[index].durationMs || 0) / 1000 });
  } else {
    engine = null;
    set({ queue, index, source: { kind: 'list', title, label }, duration: (queue[index].durationMs || 0) / 1000 });
  }
  updateMediaSession(queue[index]);
}

/** Restore the last queue (paused) so the app opens where you left off. */
export function restoreSession() {
  try {
    const raw = storage.getItem('player.session');
    if (!raw) return;
    const { queue, index, title, label, wave } = JSON.parse(raw);
    if (!Array.isArray(queue) || !queue[index]) return;
    placeSession(queue, index, title, label, wave);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------- another device (sync/elsewhere.ts)

/** This device is another's remote: what plays there shows here, and the controls go there. */
export interface Elsewhere {
  send(fn: CommandName, args: unknown[]): void;
  /** Something is started here: this device plays its own again. */
  leave(): void;
}
let elsewhere: Elsewhere | null = null;
/** The queue shown is not what the audio holds (another device's, or taken over from one): Play loads its track. */
let stale = false;
/** Where the track taken over from another device starts when it is played. */
let resumeAt: { id: string; seconds: number } | null = null;

export const isElsewhere = () => elsewhere !== null;

/** Becomes (or stops being) another device's remote. This device's own track stops, counted as heard so far. */
export function controlElsewhere(e: Elsewhere | null) {
  if (e && !elsewhere) {
    finishCurrent(false);
    listened = 0;
    forgetResume();
    ++loadSeq;
    audio.pause();
    stale = true;
    unshuffled = null;
  }
  // The repeat and the volume shown were the other device's: this one's own again.
  if (!e && elsewhere) {
    const own = loadJson<Prefs>('player.prefs', prefs);
    set({ repeat: own.repeat ?? 'off', playing: false, ...(isIos ? {} : { volume: own.volume ?? prefs.volume }) });
    if (isIos) import('./volume.ts').then((m) => m.OniVolume.get().then(({ value }) => !elsewhere && set({ volume: value })).catch(() => {}));
  }
  elsewhere = e;
}

/** What plays on the device this one is the remote of, shown as if it played here. */
export function mirror(s: { queue: Track[]; index: number; source: Source; playing: boolean; position: number; duration: number; shuffle: boolean; repeat: Repeat; volume?: number }) {
  if (!elsewhere) return;
  const t = s.queue[s.index];
  if (t && t.id !== current()?.id) updateMediaSession(t);
  // An older Oni there says no volume: the slider stays where it is.
  const { volume, ...rest } = s;
  set({ ...rest, ...(volume === undefined ? {} : { volume }), loading: false, error: null, stream: null });
}

/**
 * Another device's track here ("continue on another device"): its queue, paused at its place,
 * or playing on from there (`play`: "Play here" while this one was its remote).
 */
export function takeOver(s: { queue: Track[]; index: number; title: string; label?: ListLabel; wave?: Source }, seconds: number, play = false) {
  const t = s.queue[s.index];
  if (!t) return;
  if (!elsewhere) {
    finishCurrent(false);
    listened = 0;
    forgetResume();
    ++loadSeq;
    audio.pause();
  }
  unshuffled = null;
  placeSession(s.queue, s.index, s.title, s.label, s.wave);
  stale = true;
  resumeAt = { id: t.id, seconds };
  set({ playing: false, loading: false, position: seconds, shuffle: false, error: null, stream: null });
  persistSoon();
  if (play) void loadAt(s.index);
}
