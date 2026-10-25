// What plays on the account's other devices, in the app (the user, 24.10.2026): Oni opened on the
// phone after the PC was paused or closed shows the PC's track at the same second, paused; opened
// while the PC plays, it is the PC's remote — the PC's track with its time going, as if it played
// here, and Pause, Next, a seek go there. Starting anything here plays it here (the devices still
// play different things on their own). The same the other way round. Through Oni's folder on Yandex
// Disk (sync/playing.ts): a press arrives in 2–4 s; on the home network the phone is linked to the
// PC directly (sync/lan.ts), and a press and what plays go over the link at once, Disk as well.

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
  setVolume,
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
import { OniPlayer } from '../player/nativeAudio.ts';
import { toast } from '../store.ts';
import { isIos } from '../ui/platform.ts';
import type { Device } from './devices.ts';
import { DiskAuthError, type DiskLike } from './disk.ts';
import { Lan } from './lan.ts';
import { ALIVE, isLive, isThere, PlayingSync, positionOf, RENEW, type Command, type CommandName, type NowFile, type NowPlaying } from './playing.ts';

export interface OtherDevice {
  device: Device;
  /** Plays there now. */
  live: boolean;
  track?: Track;
  /** It is the remote of this device, or of another: nothing plays there. */
  remoteOf?: string;
}

interface ElsewhereState {
  /** The other devices with what plays there, the latest change first. */
  devices: OtherDevice[];
  /** The device this one is the remote of. */
  controlling: Device | null;
  /** The devices that are this one's remote now (it says "Controlled from iPhone"). */
  remotes: Device[];
}

export const useElsewhere = create<ElsewhereState>(() => ({ devices: [], controlling: null, remotes: [] }));
const set = useElsewhere.setState;

/** How often the folder is looked at: watched or watching, often; open or playing, now and then;
 * hidden and paused (the PC in the tray), still so that a remote picking it is noticed soon. */
const FAST = 2_500;
const OPEN = 8_000;
const IDLE = 15_000;
/** The iPhone stays awake this long after a pause while the account has other devices, so one can
 * still play it as a remote with the phone locked (the user's pick, 25.10.2026: 10 minutes). */
const AWAKE = 10 * 60;
let awake = -1;

/** After a press, a file older than it is not shown for this long (it would undo the press shown at once). */
const QUIET = 8_000;
/** A press not followed by the other device for this long: it is not there any more. */
const NO_ANSWER = 15_000;

let sync: PlayingSync | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let busy = false;
/** The ids of the devices that are this one's remote now (they look for its answers, it for their presses). */
let watchers: string[] = [];
/** A device let go here ("Disconnect"): not made this one's remote by itself again while it plays on. */
let declined: string | null = null;
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
/** The link on the home network (made once: it listens to the shell for good). */
let lan: Lan | null = null;
/** What played here before this one became a remote: back to it, paused, once let go (the user,
 * 25.10.2026: My Wave with his genres, the PC picked and let go, and the PC's track stayed here). */
let own: NowPlaying | null = null;
/** That is being put back: not a change of the user's (another device would take it up). */
let restoring = false;

/** Disk connected (sync/index.ts): the other devices are looked at, and this one's playing goes up. */
export function startElsewhere(disk: DiskLike, device: Device) {
  if (sync) return;
  sync = new PlayingSync(disk, device, () => Date.now(), transport.testMode);
  lookAround = true;
  if (Lan.possible) lan ??= new Lan(heard, linked);
  // Automated tests look when they say so (window.__wave): a test run never shows up on the user's devices by itself.
  if (transport.testMode) return;
  void listen();
  document.addEventListener('visibilitychange', onVisibility);
  schedule(0);
}

/** The PC listens on the home network and says where in its file on Disk. */
export async function listen() {
  const info = sync && (await lan?.listen(sync.device));
  if (info) await sync?.publishLan(info).catch((e) => console.warn('[lan]', e));
  return info ?? null;
}

export function stopElsewhere() {
  if (timer) clearTimeout(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  if (useElsewhere.getState().controlling) leave('keep');
  void lan?.stop();
  if (isIos && awake > 0) void OniPlayer.setAwake({ seconds: 0 }).catch(() => {});
  awake = -1;
  sync?.clear();
  sync = null;
  watchers = [];
  declined = null;
  set({ devices: [], controlling: null, remotes: [] });
}

function schedule(ms = delay()) {
  if (timer) clearTimeout(timer);
  timer = sync && !transport.testMode ? setTimeout(() => void look(), ms) : null;
}

function delay() {
  const target = useElsewhere.getState().controlling;
  // Linked on the home network: what plays there comes over the link, Disk is only looked at now and then.
  if (target && lan?.isOpen(target.id)) return OPEN;
  if (target || watchers.length) return FAST;
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
    const polled = await sync.poll();
    const { changed, commands } = polled;
    if (polled.watchers.join() !== watchers.join()) {
      watchers = polled.watchers;
      showRemotes();
    }
    for (const c of commands) run(c);
    // Done, or nothing to do: the remote sees the answer either way (it takes no answer for "gone").
    if (commands.length) publishSoon(300);
    // Every look: a device not heard of for a while goes from the list though its file stays.
    showDevices(changed);
    if (target) follow();
    // The phone links to the PCs that listen (only tried again for a newer file, or after a while).
    for (const f of sync.lanFiles()) void lan?.connect(sync.device, f);
    if (lookAround) {
      lookAround = false;
      takeUp();
    }
    // Renewed while it plays, and now and then while open and paused: the others see it is there.
    if (!isElsewhere() && Date.now() - publishedAt > (usePlayer.getState().playing ? RENEW : ALIVE)) await publish();
  } catch (e) {
    if (e instanceof DiskAuthError) return stopElsewhere();
    console.warn('[now]', e); // no network and the like: the next look tries again
  } finally {
    busy = false;
    schedule();
  }
}

/** The devices where Oni is open (or linked on the home network) with what plays there. */
function showDevices(changed = true) {
  const now = Date.now();
  const others = sync!.others();
  const there = others.filter((f) => isThere(f, now) || lan?.isOpen(f.device.id));
  const devices = there.map((f) => ({ device: f.device, live: isLive(f, now), track: f.queue[f.index], remoteOf: f.remoteOf }));
  const was = useElsewhere.getState().devices;
  if (changed || devices.map((d) => d.device.id).join() !== was.map((d) => d.device.id).join()) set({ devices });
  // The device let go has stopped: played again, it may be taken up as before.
  if (declined && !others.some((f) => f.device.id === declined && isLive(f, now))) declined = null;
  showRemotes();
  const seconds = sync!.others().length ? AWAKE : 0;
  if (isIos && seconds !== awake) {
    awake = seconds;
    void OniPlayer.setAwake({ seconds }).catch(() => {});
  }
}

/** The devices this one's remotes are, as known (a remote not known yet shows when its file comes). */
function showRemotes() {
  const known = sync?.others() ?? [];
  const remotes = watchers.map((id) => known.find((f) => f.device.id === id)?.device).filter((d): d is Device => Boolean(d));
  const was = useElsewhere.getState().remotes;
  if (remotes.map((d) => d.id).join() !== was.map((d) => d.id).join()) set({ remotes });
}

/** Opened, or back in view, with nothing playing here: the other device's track, or its remote. */
function takeUp() {
  const p = usePlayer.getState();
  if (p.playing || p.loading || isElsewhere()) return;
  // A device that is itself a remote plays nothing: neither taken up nor controlled (two devices, each
  // the other's remote, waited for each other and no press did anything: the user, 25.10.2026).
  const top = sync!.others().find((f) => !f.remoteOf);
  if (!top?.queue[top.index]) return;
  if (isLive(top, Date.now())) return top.device.id === declined ? undefined : control(top.device);
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
  if (!f || f.remoteOf) return;
  if (declined === device.id) declined = null;
  // Picking another device while a remote: what played here first is what comes back.
  if (!isElsewhere()) own = nowPlaying();
  // Said first, while what plays here is still known: else the others go on seeing it play here.
  becomeRemote(device);
  controlElsewhere({ send, leave: () => leave('drop') });
  set({ controlling: device });
  view = f;
  sentAt = 0;
  show();
  ticker ??= setInterval(show, 500);
  schedule(0);
}

/** This device becomes a remote: its file says so, and that nothing plays here now. */
function becomeRemote(target: Device) {
  const state = nowPlaying();
  if (!sync || !state) return;
  const mark = { ...state, playing: false, remoteOf: target.id };
  lan?.broadcast(JSON.stringify({ t: 'now', file: sync.fileFor(mark, changedAt) }));
  void sync.publish(mark, changedAt).catch((e) => console.warn('[now]', e));
}

/**
 * This device is no remote any more; the other one goes on as it was. `keep`: what played here
 * before comes back, paused, as it was (with nothing of its own, the other's track, paused); `drop`:
 * something else is started here. A single "Disconnect" (the user, 25.10.2026: "Play here" as well
 * was one button too many).
 */
export function leave(how: 'keep' | 'drop') {
  const target = useElsewhere.getState().controlling;
  if (!target) return;
  if (ticker) clearInterval(ticker);
  ticker = null;
  const last = view;
  view = null;
  const mine = own;
  own = null;
  set({ controlling: null });
  controlElsewhere(null);
  const s = sync;
  if (s) void s.unwatch(target.id).catch((e) => console.warn('[now]', e));
  if (how === 'drop') return;
  if (mine?.queue[mine.index]) return restore(mine);
  if (last?.queue[last.index]) take(last, false);
}

/** What played here before it became a remote, back as it was, paused; no change of the user's. */
function restore(mine: NowPlaying) {
  restoring = true;
  try {
    takeOver({ queue: mine.queue, index: mine.index, title: mine.title, label: mine.label as ListLabel | undefined, wave: mine.wave as Source | undefined }, Math.floor(mine.position), false);
  } finally {
    restoring = false;
  }
}

/** "Disconnect": this device is no remote any more, and the other plays on. It is not made that one's
 * remote again by itself while that one plays on (the user, 25.10.2026: "I only disconnected"). */
export function disconnect() {
  const target = useElsewhere.getState().controlling;
  if (!target) return;
  declined = target.id;
  leave('keep');
}

/** The file of the device controlled came: shown, unless it is older than a press just made. */
function follow() {
  const target = useElsewhere.getState().controlling;
  const f = sync?.others().find((x) => x.device.id === target?.id);
  const now = Date.now();
  if (!f) return leave('keep');
  // It became a remote itself (of this one, or of another): nothing plays there to control.
  if (f.remoteOf) {
    view = f;
    return leave('keep');
  }
  // Closed or off (its file not renewed), or a press not followed: it is not there now.
  const gone = !isThere(f, now) && !lan?.isOpen(f.device.id);
  const deaf = sentAt && now - sentAt > NO_ANSWER && f.at < sentAt;
  if (gone || deaf) {
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
    volume: v.volume,
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
  if (fn === 'volume') view = { ...v, volume: Number(args[0]) };
  if (fn === 'playAt') {
    const i = Number(args[0]);
    view = i === v.index ? { ...v, playing: !v.playing, position: at, at: now } : { ...v, index: i, position: 0, playing: true, at: now, duration: (v.queue[i]?.durationMs ?? 0) / 1000 };
  }
  sentAt = now;
  show();
  // Over the link at once, if there is one; through Disk as well (the press is done once, by its id).
  const command = sync.press(target.id, fn, sent);
  const quick = lan?.send(target.id, JSON.stringify({ t: 'cmd', to: target.id, command }));
  void sync
    .flush(target.id)
    .catch((e) => console.warn('[now]', e))
    .finally(() => !quick && schedule(FAST));
}

/** A message over the home network: what plays on a linked device, or a press for this one. */
function heard(from: string, text: string) {
  if (!sync) return;
  let msg: { t?: string; file?: NowFile; to?: string; command?: Command } | null = null;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg?.t === 'now' && msg.file && msg.file.device?.id === from && sync.receive(msg.file)) {
    showDevices();
    if (useElsewhere.getState().controlling?.id === from) follow();
  }
  if (msg?.t === 'cmd' && msg.to === sync.device.id && msg.command && sync.accept(msg.command)) {
    run(msg.command);
    // The answer at once, even if the press changed nothing (the remote takes no answer for "gone").
    setTimeout(tell, 50);
  }
}

/** A link came (or went): the linked device learns at once what plays here. */
function linked() {
  tell();
  schedule();
}

/** A press from this device's remote. */
function run(c: Command) {
  // This one is itself a remote, and yet a press came: the other device saw this one play (each was
  // the other's remote). This one stops being a remote and does the press.
  if (isElsewhere()) leave('keep');
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
    case 'volume':
      return void (Number.isFinite(Number(a)) && setVolume(Number(a)));
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

/** What plays here, for the others (null: nothing, or this one shows another device's). */
function nowPlaying(): NowPlaying | null {
  const s = usePlayer.getState();
  if (isElsewhere() || !s.queue[s.index]) return null;
  return {
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
    volume: s.volume,
  };
}

/** What plays here to the devices linked on the home network, at once. */
function tell() {
  const state = nowPlaying();
  if (!sync || !lan || !state) return;
  lan.broadcast(JSON.stringify({ t: 'now', file: sync.fileFor(state, changedAt) }));
}

export async function publish() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = null;
  const state = nowPlaying();
  if (!sync || !state) return;
  publishedAt = Date.now();
  tell();
  try {
    await sync.publish(state, changedAt);
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
    if (track && !restoring) {
      changedAt = Date.now();
      storage.setItem('now.changed', String(changedAt));
    }
    tell();
    publishSoon(s.playing !== p.playing || sought ? 300 : 600);
  } else if (s.queue.length !== p.queue.length || s.shuffle !== p.shuffle || s.repeat !== p.repeat || s.volume !== p.volume) {
    tell();
    publishSoon(2000);
  }
});

/** For the automated tests (window.__wave). */
export const elsewhereSync = () => sync;
export const elsewhereLan = () => lan;

/** A device's name in the interface language ("PC", "iPhone"). */
export function deviceName(d: Device) {
  return tr().sync.deviceName(d.platform);
}
