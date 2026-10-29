// Listening together (docs/together.md; the user, 29.10.2026: everyone equal, no middleman, several
// people). Each member plays from his own Yandex account; between the devices goes only what plays:
// a part of the queue, the track, paused or not, and where in it at a moment of the shared clock.
// Any member's press makes a new state, the latest wins. Each member's device keeps a file of what
// it knows (the member, the others it knows of, the state): over the home network it goes to the
// device of the one who started, which passes it on; from afar, it lies in his own Yandex Disk's
// open folder, read by the others. This file: those files merged, and how far a device is off.

import type { Track } from '../api/types.ts';
import type { Device } from '../sync/devices.ts';

/** What plays in the room. */
export interface RoomState {
  /** When it was made, on the shared clock (ms): the latest wins. */
  rev: number;
  /** The device that made it (two at one ms: the larger id wins). */
  by: string;
  /** A part of the queue around the track (windowOf). */
  queue: Track[];
  index: number;
  title: string;
  playing: boolean;
  /** Seconds into the track at `at` (the shared clock, ms). */
  position: number;
  at: number;
  /** Tracks (ids) still going up to their owner's Disk (a member's own upload, index.ts): the others wait for them. */
  wait?: string[];
}

export interface Member {
  device: Device;
  /** The account's name, as the others see him. */
  name: string;
  /** His open folder on Yandex Disk (the "d/…" part of its link): none without Disk (he only listens from afar). */
  link?: string;
}

/** A member's file: who he is, whom he knows of, and what plays as far as he knows. */
export interface MemberFile {
  v: 1;
  room: string;
  /** Written then, on the shared clock (ms). */
  at: number;
  me: Member;
  /** Started the room. */
  host?: boolean;
  /** Where he listens on his network (the one who started). */
  lan?: { hosts: string[]; port: number };
  state: RoomState | null;
  known: Member[];
  /** Left the room. */
  left?: boolean;
  /** Written by a test run: only test runs take it. */
  test?: boolean;
}

/** A member's file is written again this often while nothing changes (so the others see him there). */
export const RENEW = 20_000;
/** Not heard of for this long, a member is gone (closed Oni, lost his network). */
export const GONE = 60_000;

/** Of two states, the one that wins. */
export function newer(a: RoomState | null, b: RoomState | null): RoomState | null {
  if (!a || !b) return a ?? b;
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b;
  return a.by >= b.by ? a : b;
}

/** The track's place the state says at `now` (the shared clock, ms); it does not run past the track's end. */
export function targetOf(s: RoomState, now: number) {
  const on = s.playing ? Math.max(0, now - s.at) / 1000 : 0;
  const length = (s.queue[s.index]?.durationMs ?? 0) / 1000;
  return length > 0 ? Math.min(s.position + on, length) : s.position + on;
}

/** The part of a queue that goes in a state: a few played, more to come. */
const BEHIND = 3;
const AHEAD = 60;
export function windowOf(queue: Track[], index: number) {
  const from = Math.max(0, index - BEHIND);
  return { queue: queue.slice(from, index + AHEAD + 1), index: index - from };
}

/** Off by more than this (s): a seek. */
export const SEEK = 0.4;
/** Nudged until within this (s); begun only past FINE (so it does not hunt). */
const CLOSE = 0.015;
const FINE = 0.035;
/** The most a nudge changes the speed (the pitch is kept: 4 % is not heard). */
const NUDGE = 0.04;

/**
 * What a device playing at `actual` does to be at `target` (both seconds): a seek, or a speed a
 * little off 1 until it is there. `nudging`: it is being nudged now (it goes on to CLOSE).
 */
export function correction(actual: number, target: number, nudging: boolean): { seek?: number; rate: number } {
  const drift = actual - target;
  const off = Math.abs(drift);
  if (off > SEEK) return { seek: target, rate: 1 };
  if (off < (nudging ? CLOSE : FINE)) return { rate: 1 };
  // Behind: faster; ahead: slower — by more the further off (0.4 s off: the most, closed in ~10 s).
  const k = Math.min(NUDGE, Math.max(0.01, off / 10));
  return { rate: drift > 0 ? 1 - k : 1 + k };
}

/** The files of a room's members as one: who is there, what plays, who leads. */
export class Room {
  readonly id: string;
  readonly me: Device;
  private files = new Map<string, MemberFile>();
  private state: RoomState | null = null;

  constructor(id: string, me: Device) {
    this.id = id;
    this.me = me;
  }

  /** A member's file that came: true if it changed what plays (`state`) or who is there. */
  receive(file: MemberFile): { state: boolean; members: boolean } {
    if (file?.v !== 1 || file.room !== this.id || !file.me?.device?.id || file.me.device.id === this.me.id) return { state: false, members: false };
    const id = file.me.device.id;
    const known = this.files.get(id);
    if (known && known.at > file.at) return { state: false, members: false };
    const members = !known || Boolean(known.left) !== Boolean(file.left) || known.me.name !== file.me.name || known.me.link !== file.me.link || known.known.length !== file.known.length;
    this.files.set(id, file);
    return { state: this.take(file.state), members };
  }

  /** A state made here or come from another: true if it is the room's now. */
  take(s: RoomState | null) {
    const won = newer(this.state, s);
    if (!s || won !== s || won === this.state) return false;
    this.state = s;
    return true;
  }

  get current() {
    return this.state;
  }

  /** The others still there at `now` (the shared clock). */
  others(now: number): MemberFile[] {
    return [...this.files.values()].filter((f) => !f.left && now - f.at < GONE);
  }

  file(id: string) {
    return this.files.get(id);
  }

  /** The device that says when a track ends by itself: the one who started, or else the smallest id. */
  leader(now: number, iStarted: boolean): string {
    if (iStarted) return this.me.id;
    const others = this.others(now);
    const host = others.find((f) => f.host);
    if (host) return host.me.device.id;
    return [this.me.id, ...others.map((f) => f.me.device.id)].sort()[0];
  }

  /** Everyone known of, with a folder to read: the members' own and those they know (not this device). */
  people(): Member[] {
    const out = new Map<string, Member>();
    for (const f of this.files.values()) {
      for (const m of [...f.known, f.me]) if (m.device?.id && m.device.id !== this.me.id) out.set(m.device.id, { ...out.get(m.device.id), ...m });
    }
    return [...out.values()];
  }

  /** Where the one who started listens on his network, if he does. */
  lan(): { device: string; hosts: string[]; port: number } | null {
    const host = [...this.files.values()].find((f) => f.host && f.lan && !f.left);
    return host?.lan ? { device: host.me.device.id, ...host.lan } : null;
  }
}
