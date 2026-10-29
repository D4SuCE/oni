// Listening together, in the app (docs/together.md; the user, 29.10.2026: everyone equal, no
// middleman, several people). "Listen together" starts a room and gives its link; a friend's Oni
// opening it joins. What plays goes between the members' devices (room.ts): over the home network
// through the device of the one who started (lan.ts), from afar through each one's open folder on
// Yandex Disk (disk.ts). Every device plays from its own account, at the room's place on the shared
// clock (clock.ts), corrected every half second.

import { create } from 'zustand';
import { loadJson, storage, transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { outputDelay } from '../player/eq.ts';
import { OniPlayer } from '../player/nativeAudio.ts';
import {
  current,
  exactPosition,
  follow,
  followSeek,
  isSettling,
  setTogether,
  nudge,
  usePlayer,
  type ChangeHow,
} from '../player/player.ts';
import { sourceTitle } from '../player/source.ts';
import { toast, useApp } from '../store.ts';
import { disk, thisDevice, useSync } from '../sync/index.ts';
import { isIos } from '../ui/platform.ts';
import { measure, SharedClock, type Sample } from './clock.ts';
import { Folders, openFolder, removeMine, writeMine } from './disk.ts';
import { RoomLan } from './lan.ts';
import { correction, RENEW, Room, targetOf, windowOf, type Member, type MemberFile, type RoomState } from './room.ts';

export interface Person {
  id: string;
  name: string;
  platform: string;
  /** Linked on the home network (to this one, or this one to him). */
  near: boolean;
}

interface TogetherState {
  /** The room this device is in. */
  room: string | null;
  /** This one started it (the others connect to it on the network; its link is the invitation). */
  started: boolean;
  /** The others there now. */
  people: Person[];
  /** This device's open folder on Disk (its id): its own link, for the one who started to press. */
  link: string | null;
  /** The others hear this one (its presses reach the room): linked, or read from its folder. */
  heard: boolean;
}

const LINK = 'together.link';
const FRIENDS = 'together.friends';
const SAVED = 'together.room';

export const useTogether = create<TogetherState>(() => ({ room: null, started: false, people: [], link: storage.getItem(LINK), heard: false }));
const set = useTogether.setState;

/** The room is joined again after a restart within this long (the iPhone's Oni put to sleep). */
const RESUME_WITHIN = 3 * 60 * 60_000;
const TICK = 500;
const POLL = 2500;
/** Friends' folders are looked into every this many polls (the one who started, waiting for them). */
const FRIENDS_EVERY = 4;
/** Not on the room's track or not playing as it does for this long: it is put right. */
const OUT_OF_STEP = 2500;
/** The time is asked again this often. */
const RECLOCK = 10 * 60_000;

const clock = new SharedClock();
let room: Room | null = null;
let lan: RoomLan | null = null;
let lanInfo: { hosts: string[]; port: number } | null = null;
const folders = new Folders((req) => transport.request(req));
/** Folders read besides the members' own: the one from the invitation, the links pressed. */
let extra = new Set<string>();
let timers: ReturnType<typeof setInterval>[] = [];
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> | null = null;
let dirty = false;
let polls = 0;
let nudging = false;
let outOfStep: number | null = null;
/** Seconds from the player to the ear (Bluetooth), asked now and then. */
let latency = 0;
let left = false;
const lanSamples: Sample[] = [];

const friends = () => loadJson<Record<string, { name: string; at: number }>>(FRIENDS, {});
function befriend(m: Member) {
  if (!m.link || m.link === useTogether.getState().link) return;
  const all = friends();
  all[m.link] = { name: m.name, at: Date.now() };
  storage.setItem(FRIENDS, JSON.stringify(all));
}

function me(): Member {
  const a = useApp.getState().account;
  const link = useTogether.getState().link;
  return { device: thisDevice, name: a?.displayName || a?.login || tr().together.someone, ...(link ? { link } : {}) };
}

const diskOn = () => Boolean(useSync.getState().connected);
const randomId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '').slice(0, 24);

// ------------------------------------------------------------------ in and out

/** "Listen together": a room of this device's; what plays here is what it starts with. */
export async function startTogether() {
  if (!diskOn()) return void toast(tr().together.needDisk);
  if (room) await leaveTogether();
  await begin(randomId(), true, []);
  tell('user');
}

/** A link opened: `room` joined through the folder `folder` (or, in that room already, the folder
 * read too: a guest's own link pressed by the one who started). */
export async function joinRoom(roomId: string, folder: string) {
  if (room?.id === roomId) {
    if (folder !== useTogether.getState().link && !extra.has(folder)) {
      extra.add(folder);
      save();
      void poll();
      toast(tr().together.linkTaken);
    }
    return;
  }
  if (room) await leaveTogether();
  await begin(roomId, false, [folder]);
  toast(tr().together.joined);
}

export async function leaveTogether() {
  if (!room) return;
  const id = room.id;
  left = true;
  const file = myFile();
  left = false;
  for (const t of timers) clearInterval(t);
  timers = [];
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  lan?.send(JSON.stringify({ t: 'file', file }));
  await lan?.stop();
  lanInfo = null;
  setTogether(null);
  room = null;
  extra = new Set();
  folders.clear();
  nudging = false;
  storage.removeItem(SAVED);
  set({ room: null, started: false, people: [], heard: false });
  // The others see "left" at once; the file goes a little later (they may read it meanwhile).
  if (diskOn() && useTogether.getState().link) {
    await writeMine(disk, file).catch(() => {});
    setTimeout(() => void removeMine(disk, id).catch(() => {}), 15_000);
  }
}

/** At start: the room this device was in a little while ago, joined again. */
export async function resumeTogether() {
  const saved = loadJson<{ id: string; started: boolean; extra: string[]; at: number } | null>(SAVED, null);
  if (!saved || room || Date.now() - saved.at > RESUME_WITHIN) return;
  await begin(saved.id, saved.started, saved.extra);
}

function save() {
  if (room) storage.setItem(SAVED, JSON.stringify({ id: room.id, started: useTogether.getState().started, extra: [...extra], at: Date.now() }));
}

async function begin(id: string, started: boolean, folders_: string[]) {
  room = new Room(id, thisDevice);
  extra = new Set(folders_);
  polls = 0;
  outOfStep = null;
  set({ room: id, started, people: [], heard: started });
  save();
  lan ??= new RoomLan({ text: onText, guests: onGuests, closed: onClosed });
  setTogether({ changed: (what, how) => tell(how, what) });
  void syncClock();
  if (diskOn()) {
    try {
      const link = await openFolder(disk);
      storage.setItem(LINK, link);
      set({ link });
    } catch (e) {
      console.warn('[together] no folder', e);
    }
  }
  if (started && RoomLan.possible) lanInfo = await lan.serve(id, thisDevice);
  if (room?.id !== id) return;
  timers = [setInterval(tick, TICK), setInterval(() => void poll(), POLL), setInterval(() => writeSoon(), RENEW), setInterval(() => void syncClock(), RECLOCK)];
  writeSoon(0);
  void poll();
}

// ------------------------------------------------------------------ the shared clock and the ear

async function syncClock() {
  const samples = await measure(async () => {
    const r = await transport.request<{ time?: number }>({ url: 'https://yandex.ru/time/sync.json' });
    if (!r.ok || typeof r.data?.time !== 'number') throw new Error('no time');
    return r.data.time;
  });
  // Yandex's time is the room's; a guest linked on the network learns it from the one who started (surer).
  clock.learn(samples, !lan?.linkedTo);
  if (lan?.linkedTo) askHostTime();
  if (isIos) latency = (await OniPlayer.state().catch(() => null))?.latency ?? 0;
}

function askHostTime() {
  lanSamples.length = 0;
  for (let i = 0; i < 6; i++) setTimeout(() => lan?.send(JSON.stringify({ t: 'time?', c: Date.now() })), i * 150);
}

/** Seconds the player is ahead of what is heard: on the desktop the output's buffering (Bluetooth), on the iPhone the session's. */
const ahead = () => (isIos ? latency : outputDelay() / 1000) + (Number(storage.getItem('together.offset')) || 0) / 1000;

// ------------------------------------------------------------------ what plays

/** A change here (a press, a track that ended, the queue growing): the room's state now. */
function tell(how: ChangeHow, what: { playing?: boolean; position?: number } = {}) {
  if (!room) return;
  const now = clock.now();
  const started = useTogether.getState().started;
  if (how === 'natural' && room.leader(now, started) !== thisDevice.id) return;
  if (how === 'queue') {
    const s = room.current;
    if (!s || String(s.queue[s.index]?.id) !== String(current()?.id)) return;
  }
  const p = usePlayer.getState();
  if (p.index < 0 || !p.queue[p.index]) return;
  const state: RoomState = {
    rev: now,
    by: thisDevice.id,
    ...windowOf(p.queue, p.index),
    title: sourceTitle(p.source),
    playing: what.playing ?? p.playing,
    position: Math.max(0, (what.position ?? exactPosition()) - ahead()),
    at: now,
  };
  room.take(state);
  outOfStep = null;
  writeSoon();
}

/** The room's state, played here. */
function apply(s: RoomState) {
  outOfStep = null;
  nudging = false;
  nudge(1);
  follow({ queue: s.queue, index: s.index, title: s.title }, targetOf(s, clock.now()) + (s.playing ? ahead() : 0), s.playing);
}

/** Every half second: on the room's track at its place, or put there. */
function tick() {
  const s = room?.current;
  if (!room || !s) return;
  const now = clock.now();
  const mine = current();
  const theirs = s.queue[s.index];
  const p = usePlayer.getState();
  const sameTrack = Boolean(mine && theirs && String(mine.id) === String(theirs.id));
  // The room's track has ended by its clock and this one went on to the next by itself: in step
  // (the one who leads says so in a moment).
  const length = (theirs?.durationMs ?? 0) / 1000;
  const wentOn = !sameTrack && s.playing && length > 0 && targetOf(s, now) >= length - 1 && String(mine?.id) === String(s.queue[s.index + 1]?.id);
  const inStep = wentOn || (sameTrack && (p.playing === s.playing || isSettling()));
  if (!inStep) {
    outOfStep ??= now;
    if (now - outOfStep > OUT_OF_STEP) apply(s);
    return;
  }
  outOfStep = null;
  if (!sameTrack || !s.playing || !p.playing || isSettling()) {
    if (nudging) nudge(1);
    nudging = false;
    return;
  }
  const c = correction(exactPosition(), targetOf(s, now) + ahead(), nudging);
  if (c.seek !== undefined) {
    nudging = false;
    nudge(1);
    followSeek(c.seek);
    return;
  }
  nudging = c.rate !== 1;
  nudge(c.rate);
}

// ------------------------------------------------------------------ the files

function myFile(): MemberFile {
  const r = room!;
  const started = useTogether.getState().started;
  return {
    v: 1,
    room: r.id,
    at: clock.now(),
    me: me(),
    ...(started ? { host: true } : {}),
    ...(started && lanInfo ? { lan: lanInfo } : {}),
    state: r.current,
    known: r.people(),
    ...(left ? { left: true } : {}),
    ...(transport.testMode ? { test: true } : {}),
  };
}

/** This device's file to the others: over the network at once, to its folder on Disk one at a time. */
function writeSoon(delay = 100) {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!room) return;
    const file = myFile();
    lan?.send(JSON.stringify({ t: 'file', file }));
    if (!diskOn() || !useTogether.getState().link) return;
    if (writing) return void (dirty = true);
    writing = writeMine(disk, file)
      .catch((e) => console.warn('[together] write', e))
      .finally(() => {
        writing = null;
        if (dirty) {
          dirty = false;
          writeSoon(0);
        }
      });
  }, delay);
}

/** A member's file came: the room takes what is new in it. */
function receive(file: MemberFile, via: 'lan' | 'disk', from?: string) {
  if (!room || Boolean(file?.test) !== Boolean(transport.testMode)) return;
  const r = room.receive(file);
  // The one who started passes it on to the others on the network.
  if (via === 'lan' && useTogether.getState().started) for (const id of lan?.guestIds ?? []) if (id !== from) lan?.send(JSON.stringify({ t: 'file', file }), id);
  if (file.me?.link) befriend(file.me);
  if (r.state && room.current) apply(room.current);
  if (r.members || r.state) people();
}

function people() {
  if (!room) return;
  const now = clock.now();
  const near = new Set([...(lan?.guestIds ?? []), ...(lan?.linkedTo ? [lan.linkedTo] : [])]);
  const others = room.others(now);
  const heard = useTogether.getState().started || Boolean(lan?.linkedTo) || others.some((f) => f.known.some((m) => m.device.id === thisDevice.id));
  set({
    people: others.map((f) => ({ id: f.me.device.id, name: f.me.name, platform: f.me.device.platform, near: near.has(f.me.device.id) })),
    heard,
  });
}

/** Every 2.5 s: the folders read, the network link to the one who started tried. */
async function poll() {
  if (!room) return;
  const id = room.id;
  const own = useTogether.getState().link;
  const links = new Set([...extra, ...room.people().map((m) => m.link).filter((l): l is string => Boolean(l))]);
  if (useTogether.getState().started && polls % FRIENDS_EVERY === 0) for (const l of Object.keys(friends())) links.add(l);
  polls++;
  if (own) links.delete(own);
  const files = links.size ? await folders.poll(id, [...links]).catch(() => []) : [];
  if (room?.id !== id) return;
  for (const f of files) receive(f, 'disk');
  const host = room.lan();
  if (!useTogether.getState().started && host && lan && !lan.linkedTo && (await lan.connect(host.device, host.hosts, host.port, id, thisDevice))) {
    writeSoon(0);
    askHostTime();
  }
  people();
}

function onText(from: string, text: string) {
  let msg: any;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg?.t === 'file') receive(msg.file, 'lan', from);
  else if (msg?.t === 'time?') lan?.send(JSON.stringify({ t: 'time', c: msg.c, h: clock.now() }), from);
  else if (msg?.t === 'time' && typeof msg.c === 'number' && typeof msg.h === 'number') {
    lanSamples.push({ sent: msg.c, got: Date.now(), told: msg.h });
    if (lanSamples.length >= 3) clock.learn(lanSamples, true);
  }
}

/** The one who started: a guest came on the network — he gets what is known (this one's file, the others'). */
function onGuests(ids: string[]) {
  if (!room) return;
  writeSoon(0);
  for (const id of ids) for (const f of room.others(clock.now())) lan?.send(JSON.stringify({ t: 'file', file: f }), id);
  people();
}

function onClosed() {
  people();
}

/** The invitation: this room through this device's folder (anyone's link works: it is read for the rest). */
export function inviteLink(): { room: string; folder: string } | null {
  const link = useTogether.getState().link;
  return room && link ? { room: room.id, folder: link } : null;
}


/** For the automated test (tests/e2e/13-together.mjs): the room's clock, state and address. */
export const togetherProbe = { now: () => clock.now(), state: () => room?.current ?? null, lan: () => lanInfo, ahead };
