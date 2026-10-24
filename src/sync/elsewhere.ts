// What plays on the account's other devices, in the app (the user, 24.10.2026): Oni opened on the
// phone after the PC was paused or closed shows the PC's track at the same second, paused; opened
// while the PC plays, it is the PC's remote — the PC's track with its time going, as if it played
// here, and Pause, Next, a seek go there. Starting anything here plays it here (the devices still
// play different things on their own). The same the other way round. Through Oni's folder on Yandex
// Disk (sync/playing.ts): a press arrives in 2–4 s.

import { create } from 'zustand';
import { storage, transport } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { tr } from '../i18n.ts';
import {
  controlElsewhere,
  cycleRepeat,
  enqueue,
  isElsewhere,
  mirror,
  moveInQueue,
  next,
  playAt,
  playNext,
  prev,
  removeAt,
  seek,
  takeOver,
  toggle,
  toggleShuffle,
  usePlayer,
  labelOf,
  sourceTitle,
  type ListLabel,
  type Repeat,
  type Source,
} from '../player/player.ts';
import { toast } from '../store.ts';
import type { Device } from './devices.ts';
import { DiskAuthError, type DiskLike } from './disk.ts';
import { isLive, PlayingSync, positionOf, RENEW, type Command, type CommandName, type NowFile } from './playing.ts';

export interface OtherDevice {
  device: Device;
  /** Plays there now. */
  live: boolean;
  track?: Track;
}

interface ElsewhereState {
  /** The other devices with what plays there, the latest change first. */
  devices: OtherDevice[];
  /** The device this one is the remote of. */
  controlling: Device | null;
}

export const useElsewhere = create<ElsewhereState>(() => ({ devices: [], controlling: null }));
const set = useElsewhere.setState;

/** How often the folder is looked at: watched or watching, often; open or playing, now and then;
 * hidden and paused (the PC in the tray), still so that a remote picking it is noticed soon. */
const FAST = 2_500;
const OPEN = 8_000;
const IDLE = 15_000;
/** After a press, a file older than it is not shown for this long (it would undo the press shown at once). */
const QUIET = 8_000;
/** A press not followed by the other device for this long: it is not there any more. */
const NO_ANSWER = 15_000;

let sync: PlayingSync | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let busy = false;
let watched = false;
/** Look around (take up another device's track, or become its remote) after the next look. */
let lookAround = true;
/** What the device this one controls plays, as shown (a press changes it at once, its file later). */
let view: NowFile | null = null;
let sentAt = 0;
/** When the playing here last changed, and the change of another device last taken up. */
let changedAt = Number(storage.getItem('now.changed')) || 0;
let takenAt = Number(storage.getItem('now.taken')) || 0;
let publishedAt = 0;
let publishTimer: ReturnType<typeof setTimeout> | null = null;

/** Disk connected (sync/index.ts): the other devices are looked at, and this one's playing goes up. */
export function startElsewhere(disk: DiskLike, device: Device) {
  if (sync) return;
  sync = new PlayingSync(disk, device, () => Date.now(), transport.testMode);
  lookAround = true;
  // Automated tests look when they say so (window.__wave): a test run never shows up on the user's devices by itself.
  if (transport.testMode) return;
  document.addEventListener('visibilitychange', onVisibility);
  schedule(0);
}

export function stopElsewhere() {
  if (timer) clearTimeout(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  if (useElsewhere.getState().controlling) leave('keep');
  sync?.clear();
  sync = null;
  set({ devices: [], controlling: null });
}

function schedule(ms = delay()) {
  if (timer) clearTimeout(timer);
  timer = sync && !transport.testMode ? setTimeout(() => void look(), ms) : null;
}

function delay() {
  if (useElsewhere.getState().controlling || watched) return FAST;
  return !document.hidden || usePlayer.getState().playing ? OPEN : IDLE;
}

function onVisibility() {
  if (document.hidden) return void publish();
  lookAround = true;
  schedule(0);
}

/** One look at the folder: presses for this device are done, the others' tracks shown. `around`:
 * and then take up another device's track, or become its remote, if nothing plays here. */
export async function look(around = false) {
  if (around) lookAround = true;
  if (!sync || busy) return;
  busy = true;
  try {
    const target = useElsewhere.getState().controlling;
    if (target) await sync.watch(target.id);
    const { changed, commands, watched: w } = await sync.poll();
    watched = w;
    for (const c of commands) run(c);
    // Done, or nothing to do: the remote sees the answer either way (it takes no answer for "gone").
    if (commands.length) publishSoon(300);
    if (changed) showDevices();
    if (target) follow();
    if (lookAround) {
      lookAround = false;
      takeUp();
    }
    if (usePlayer.getState().playing && !isElsewhere() && Date.now() - publishedAt > RENEW) await publish();
  } catch (e) {
    if (e instanceof DiskAuthError) return stopElsewhere();
    console.warn('[now]', e); // no network and the like: the next look tries again
  } finally {
    busy = false;
    schedule();
  }
}

function showDevices() {
  const now = Date.now();
  set({ devices: sync!.others().map((f) => ({ device: f.device, live: isLive(f, now), track: f.queue[f.index] })) });
}

/** Opened, or back in view, with nothing playing here: the other device's track, or its remote. */
function takeUp() {
  const p = usePlayer.getState();
  if (p.playing || p.loading || isElsewhere()) return;
  const top = sync!.others()[0];
  if (!top?.queue[top.index]) return;
  if (isLive(top, Date.now())) return control(top.device);
  if (top.changed > changedAt && top.changed > takenAt) take(top, false);
}

/** Its queue here, at its place: paused, or (`play`) playing on from there. */
function take(f: NowFile, play: boolean) {
  takenAt = f.changed;
  storage.setItem('now.taken', String(takenAt));
  takeOver(
    { queue: f.queue, index: f.index, title: f.title, label: f.label as ListLabel | undefined, wave: f.wave as Source | undefined },
    Math.floor(positionOf(f, Date.now())),
    play,
  );
  // The change was the other device's, at its time: taken up there again, it would go back and forth.
  if (!play) {
    changedAt = f.changed;
    storage.setItem('now.changed', String(changedAt));
  }
}

// ------------------------------------------------------------ the remote

/** This device becomes the remote of `device`: what plays there shows here. */
export function control(device: Device) {
  if (!sync) return;
  const f = sync.others().find((x) => x.device.id === device.id);
  if (!f) return;
  controlElsewhere({ send, leave: () => leave('drop') });
  set({ controlling: device });
  view = f;
  sentAt = 0;
  show();
  ticker ??= setInterval(show, 500);
  schedule(0);
}

/**
 * This device plays its own again. What played there: `here` goes on here from where it was, and
 * stops there ("Play here"); `keep` stays here paused, as if taken over; `drop` is let go
 * (something else is started here).
 */
export function leave(how: 'here' | 'keep' | 'drop') {
  const target = useElsewhere.getState().controlling;
  if (!target) return;
  if (ticker) clearInterval(ticker);
  ticker = null;
  const last = view;
  view = null;
  set({ controlling: null });
  controlElsewhere(null);
  if (!last?.queue[last.index] || how === 'drop') return;
  if (how === 'here' && last.playing) void sync?.send(target.id, 'pause').catch((e) => console.warn('[now]', e));
  take(last, how === 'here');
}

/** The file of the device controlled came: shown, unless it is older than a press just made. */
function follow() {
  const target = useElsewhere.getState().controlling;
  const f = sync?.others().find((x) => x.device.id === target?.id);
  const now = Date.now();
  if (!f) return leave('keep');
  // Closed while it played (its file not renewed), or a press not followed: it is not there now.
  const playingGone = f.playing && !isLive(f, now);
  const deaf = sentAt && now - sentAt > NO_ANSWER && f.at < sentAt;
  if (playingGone || deaf) {
    toast(tr().elsewhere.gone(deviceName(f.device)));
    view = { ...f, playing: false, position: positionOf(view ?? f, now) };
    return leave('keep');
  }
  if (now - sentAt < QUIET && f.at < sentAt) return;
  view = f;
  show();
}

/** The source shown, made once per file (made anew on every tick, everything showing it drew again). */
let shownSource: { of: NowFile; source: Source } | null = null;

function show() {
  if (!view || !isElsewhere()) return;
  const v = view;
  if (shownSource?.of.wave !== v.wave || shownSource?.of.title !== v.title) {
    shownSource = { of: v, source: (v.wave as Source | undefined) ?? { kind: 'list', title: v.title, label: v.label as ListLabel | undefined } };
  }
  const source = shownSource.source;
  mirror({
    queue: v.queue,
    index: v.index,
    source,
    playing: v.playing,
    position: positionOf(v, Date.now()),
    duration: v.duration || (v.queue[v.index]?.durationMs ?? 0) / 1000,
    shuffle: v.shuffle,
    repeat: (v.repeat as Repeat) || 'off',
  });
}

/** A press here goes to the device controlled; shown at once where it can be. */
function send(fn: CommandName, args: unknown[]) {
  const target = useElsewhere.getState().controlling;
  if (!sync || !target || !view) return;
  const v = view;
  const now = Date.now();
  const at = positionOf(v, now);
  // The queue shown is a part of the device's own: places in it go with the track's id.
  const place = (i: unknown) => [Number(i) + v.offset, v.queue[Number(i)]?.id];
  let sent = args;
  if (fn === 'playAt' || fn === 'removeAt') sent = place(args[0]);
  if (fn === 'moveInQueue') sent = [...place(args[0]), Number(args[1]) + v.offset];
  // Shown before the device has done it (its file comes in a few seconds).
  if (fn === 'toggle') view = { ...v, playing: !v.playing, position: at, at: now };
  if (fn === 'next' && v.index + 1 < v.queue.length) view = { ...v, index: v.index + 1, position: 0, at: now, duration: (v.queue[v.index + 1].durationMs ?? 0) / 1000 };
  if (fn === 'prev') {
    const back = at <= 3 && v.index > 0;
    view = { ...v, index: back ? v.index - 1 : v.index, position: 0, at: now, duration: back ? (v.queue[v.index - 1].durationMs ?? 0) / 1000 : v.duration };
  }
  if (fn === 'seek') view = { ...v, position: Number(args[0]) || 0, at: now };
  if (fn === 'playAt') {
    const i = Number(args[0]);
    view = i === v.index ? { ...v, playing: !v.playing, position: at, at: now } : { ...v, index: i, position: 0, playing: true, at: now, duration: (v.queue[i]?.durationMs ?? 0) / 1000 };
  }
  sentAt = now;
  show();
  void sync
    .send(target.id, fn, sent)
    .catch((e) => console.warn('[now]', e))
    .finally(() => schedule(FAST));
}

/** A press from this device's remote. */
function run(c: Command) {
  // This one is itself a remote now: nothing plays here to press.
  if (isElsewhere()) return;
  const s = usePlayer.getState();
  /** The track's place now: by its id, if the queue moved since the remote saw it. */
  const place = (i: unknown, id: unknown) => (s.queue[Number(i)]?.id === id ? Number(i) : s.queue.findIndex((t) => t.id === id));
  const [a, b, d] = c.args;
  switch (c.fn) {
    case 'toggle':
      return toggle();
    case 'play':
      return void (!s.playing && toggle());
    case 'pause':
      return void (s.playing && toggle());
    case 'next':
      return void next(true);
    case 'prev':
      return prev();
    case 'seek':
      return seek(Number(a));
    case 'playAt': {
      const i = place(a, b);
      return void (i >= 0 && playAt(i));
    }
    case 'removeAt': {
      const i = place(a, b);
      return void (i >= 0 && removeAt(i));
    }
    case 'moveInQueue': {
      const from = place(a, b);
      return void (from >= 0 && moveInQueue(from, from + Number(d) - Number(a)));
    }
    case 'playNext':
      return playNext(a as Track);
    case 'enqueue':
      return enqueue(a as Track);
    case 'cycleRepeat':
      return cycleRepeat();
    case 'toggleShuffle':
      return toggleShuffle();
  }
}

// ------------------------------------------------------ this device's playing

/** What plays here goes up soon after it changes (several changes at once go up together). */
function publishSoon(ms = 600) {
  if (!sync || transport.testMode) return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => void publish(), ms);
}

export async function publish() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = null;
  const s = usePlayer.getState();
  if (!sync || isElsewhere() || !s.queue[s.index]) return;
  publishedAt = Date.now();
  try {
    await sync.publish(
      {
        queue: s.queue,
        index: s.index,
        offset: 0,
        title: sourceTitle(s.source),
        label: labelOf(s.source),
        wave: s.source?.kind === 'wave' ? s.source : undefined,
        playing: s.playing,
        position: s.position,
        duration: s.duration,
        shuffle: s.shuffle,
        repeat: s.repeat,
      },
      changedAt,
    );
  } catch (e) {
    console.warn('[now]', e);
  }
}

usePlayer.subscribe((s, p) => {
  if (isElsewhere() || !sync) return;
  const track = s.queue[s.index]?.id;
  const sought = track === p.queue[p.index]?.id && Math.abs(s.position - p.position) > 2.5;
  if (track !== p.queue[p.index]?.id || s.playing !== p.playing || sought) {
    // Only what the user does counts as a change: a track opening (loading) is not a pause.
    if (track) {
      changedAt = Date.now();
      storage.setItem('now.changed', String(changedAt));
    }
    publishSoon(s.playing !== p.playing || sought ? 300 : 600);
  } else if (s.queue.length !== p.queue.length || s.shuffle !== p.shuffle || s.repeat !== p.repeat) publishSoon(2000);
});

/** For the automated tests (window.__wave). */
export const elsewhereSync = () => sync;

/** A device's name in the interface language ("PC", "iPhone"). */
export function deviceName(d: Device) {
  return tr().sync.deviceName(d.platform);
}
