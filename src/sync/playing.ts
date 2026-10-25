// "Continue on another device" and the remote (the user, 24.10.2026; Yandex's own way, Ynison, is off
// for the account even in Yandex's apps, 25.10.2026): each device keeps a small file in Oni's folder
// on Yandex Disk, `now-<id>.json`, with what it plays and where, renewed while it plays. A device used
// as another's remote leaves its presses in `cmd-<target>-<self>.json`: one writer per file, so
// nothing is overwritten by another device. The target reads it every few seconds while it is
// watched (Disk does not push: a press arrives in 2–4 s).

import type { Track } from '../api/types.ts';
import type { DiskLike } from './disk.ts';
import type { Device } from './devices.ts';

/** What plays on a device, as the other devices see it (player.ts's state, in short). */
export interface NowPlaying {
  /** A part of the queue around the track playing; `offset`: where it begins in the device's own. */
  queue: Track[];
  index: number;
  offset: number;
  title: string;
  /** player.ts's ListLabel and wave Source, kept as they are (the file only carries them). */
  label?: unknown;
  wave?: unknown;
  playing: boolean;
  /** Seconds into the track when the file was written (`at`). */
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: string;
  /** 0–1 (the iPhone's: the phone's own); a remote moves it (older files have none). */
  volume?: number;
  /** This device is the remote of that one: nothing plays here (it is not to be taken up or controlled). */
  remoteOf?: string;
}

export interface NowFile extends NowPlaying {
  v: 1;
  device: Device;
  /** When it was written (this device's clock), ms epoch. */
  at: number;
  /** When the playing last changed (a track, a pause, a seek): not the renewal while it plays. */
  changed: number;
  /** Written by a test run: only test runs see it (the user's devices never take it up). */
  test?: boolean;
}

export type CommandName = 'toggle' | 'play' | 'pause' | 'next' | 'prev' | 'seek' | 'volume' | 'playAt' | 'playNext' | 'enqueue' | 'moveInQueue' | 'removeAt' | 'cycleRepeat' | 'toggleShuffle';

export interface Command {
  id: string;
  at: number;
  fn: CommandName;
  args: unknown[];
}

export interface CommandFile {
  v: 1;
  from: Device;
  /** Written last (a press, or "still watching"), ms epoch. */
  at: number;
  commands: Command[];
}

const NOW = 'now-';
const CMD = 'cmd-';
const LAN = 'lan-';
const nowFileOf = (id: string) => `${NOW}${id}.json`;
export const commandFileOf = (to: string, from: string) => `${CMD}${to}-${from}.json`;
const lanFileOf = (id: string) => `${LAN}${id}.json`;

/** Where a PC listens on the home network (sync/lan.ts): its file, with the key a connection says. */
export interface LanFile {
  v: 1;
  device: Device;
  at: number;
  hosts: string[];
  port: number;
  key: string;
  test?: boolean;
}

/** A playing device renews its file this often; not renewed for LIVE, it has stopped (closed, no network). */
export const RENEW = 30_000;
export const LIVE = 75_000;
/** An open Oni renews its file this often even paused; not renewed for AWAY, it is not there (closed, the
 * PC off, the phone's Oni asleep): not offered as a remote (the user, 25.10.2026, saw the PC's track
 * from the phone with the PC off). */
export const ALIVE = 60_000;
export const AWAY = 150_000;
/** A remote says it is still watching this often; a target not told for WATCHED is not watched any more. */
const STILL_WATCHING = 20_000;
const WATCHED = 60_000;
/** Presses are kept in the file this long (the target may look only every few seconds). */
const KEEP = 2 * 60_000;
/** A press older than this, found when a file is first read, is not acted on (Oni was closed meanwhile). */
const STALE_PRESS = 30_000;
/** The part of a queue that goes in the file: a few played, more to come. */
const BEHIND = 5;
const AHEAD = 40;

/** The track's place a device's file says now: on from `position` while it plays. */
export function positionOf(f: NowPlaying & { at: number }, now: number) {
  const on = f.playing ? Math.max(0, now - f.at) / 1000 : 0;
  return f.duration > 0 ? Math.min(f.position + on, f.duration) : f.position + on;
}

/** Playing there now: the file says so and is renewed. */
export const isLive = (f: NowFile, now: number) => f.playing && now - f.at < LIVE;

/** Oni is open there: the file is renewed (playing, or paused and open). */
export const isThere = (f: NowFile, now: number) => now - f.at < (f.playing ? LIVE : AWAY);

export class PlayingSync {
  private disk: DiskLike;
  readonly device: Device;
  private now: () => number;
  private test: boolean;
  /** The other devices' files as last read, by file name; `stamp`: Disk's mark of that version. */
  private theirs = new Map<string, { stamp: string; file: NowFile }>();
  /** The presses to this device: files as last read (`from`: the remote's id), and the presses already acted on. */
  private inbox = new Map<string, { stamp: string; at: number; from: string }>();
  private done = new Set<string>();
  /** This device's presses, per device it controls. */
  private outbox = new Map<string, CommandFile>();
  /** Where the other devices listen on the home network (sync/lan.ts), by file name. */
  private lans = new Map<string, { stamp: string; file: LanFile }>();
  private seq = 0;

  constructor(disk: DiskLike, device: Device, now = () => Date.now(), test = false) {
    this.disk = disk;
    this.device = device;
    this.now = now;
    this.test = test;
  }

  get fileName() {
    return nowFileOf(this.device.id);
  }

  /** Writes what plays here. `changed`: when it last changed (kept by the caller). */
  async publish(state: NowPlaying, changed: number) {
    const file = this.fileFor(state, changed);
    await this.disk.write(this.fileName, JSON.stringify(file));
    return file;
  }

  /** What plays here, as it goes in the file (and over the home network). */
  fileFor(state: NowPlaying, changed: number): NowFile {
    const from = Math.max(0, state.index - BEHIND);
    return {
      v: 1,
      device: this.device,
      ...state,
      queue: state.queue.slice(from, state.index + AHEAD + 1),
      index: state.index - from,
      offset: state.offset + from,
      at: this.now(),
      changed,
      ...(this.test ? { test: true } : {}),
    };
  }

  /** Another device's file that came over the home network: kept if it is newer than the one known. */
  receive(file: NowFile) {
    if (file?.v !== 1 || !file.device || file.device.id === this.device.id || Boolean(file.test) !== this.test) return false;
    const name = nowFileOf(file.device.id);
    const known = this.theirs.get(name);
    if (known && known.file.at >= file.at) return false;
    this.theirs.set(name, { stamp: known?.stamp ?? '', file });
    return true;
  }

  /** A press that came over the home network: true if it is to be done (not done yet). */
  accept(c: Command) {
    if (!c?.id || this.done.has(c.id)) return false;
    this.done.add(c.id);
    return true;
  }

  /** Where this device listens on the home network, for the others. */
  async publishLan(info: Omit<LanFile, 'at'>) {
    await this.disk.write(lanFileOf(this.device.id), JSON.stringify({ ...info, at: this.now() }));
  }

  /** Where the other devices listen, as last read. */
  lanFiles(): LanFile[] {
    return [...this.lans.values()].map((x) => x.file);
  }

  /**
   * One look at the folder: the other devices' files that changed are read, and the presses to
   * this device that are new. `watchers`: the devices that are this one's remote now.
   */
  async poll(): Promise<{ changed: boolean; commands: Command[]; watchers: string[] }> {
    const listed = await this.disk.list();
    const stamp = (f: { modified: string; md5?: string }) => `${f.modified}|${f.md5 ?? ''}`;
    let changed = false;
    const names = new Set<string>();
    for (const f of listed) {
      if (!f.name.startsWith(NOW) || !f.name.endsWith('.json') || f.name === this.fileName) continue;
      names.add(f.name);
      if (this.theirs.get(f.name)?.stamp === stamp(f)) continue;
      const file = await this.readJson<NowFile>(f.name);
      // A file of a later Oni (another format), a broken one, or a test run's (unless this is one).
      if (file?.v !== 1 || !file.device || file.device.id === this.device.id || Boolean(file.test) !== this.test) continue;
      // What came over the home network meanwhile is newer than this file: kept.
      const known = this.theirs.get(f.name);
      if (known && known.file.at > file.at) {
        known.stamp = stamp(f);
        continue;
      }
      this.theirs.set(f.name, { stamp: stamp(f), file });
      changed = true;
    }
    for (const name of this.theirs.keys()) {
      if (!names.has(name)) {
        this.theirs.delete(name);
        changed = true;
      }
    }

    for (const f of listed) {
      if (!f.name.startsWith(LAN) || !f.name.endsWith('.json') || f.name === lanFileOf(this.device.id)) continue;
      if (this.lans.get(f.name)?.stamp === stamp(f)) continue;
      const file = await this.readJson<LanFile>(f.name);
      if (file?.v !== 1 || !file.device || !Array.isArray(file.hosts) || Boolean(file.test) !== this.test) continue;
      this.lans.set(f.name, { stamp: stamp(f), file });
    }

    const commands: Command[] = [];
    const mine = `${CMD}${this.device.id}-`;
    for (const f of listed) {
      if (!f.name.startsWith(mine) || !f.name.endsWith('.json')) continue;
      const known = this.inbox.get(f.name);
      if (known?.stamp === stamp(f)) continue;
      const file = await this.readJson<CommandFile>(f.name);
      if (file?.v !== 1 || !Array.isArray(file.commands)) continue;
      for (const c of file.commands) {
        if (this.done.has(c.id)) continue;
        this.done.add(c.id);
        // Found at the first read of the file: what was pressed long ago is not done now.
        if (!known && this.now() - c.at > STALE_PRESS) continue;
        commands.push(c);
      }
      this.inbox.set(f.name, { stamp: stamp(f), at: file.at, from: f.name.slice(mine.length, -'.json'.length) });
    }
    commands.sort((a, b) => a.at - b.at);
    const watchers = [...this.inbox.values()].filter((x) => this.now() - x.at < WATCHED).map((x) => x.from);
    return { changed, commands, watchers };
  }

  /** The other devices' files, the latest change first. */
  others(): NowFile[] {
    return [...this.theirs.values()].map((x) => x.file).sort((a, b) => b.changed - a.changed);
  }

  /** A press for another device: it goes up with the ones of the last minutes. */
  async send(to: string, fn: CommandName, args: unknown[] = []) {
    this.press(to, fn, args);
    await this.flush(to);
  }

  /** A press made, kept for `to` (it goes up with flush); the same press may go over the home network too. */
  press(to: string, fn: CommandName, args: unknown[] = []): Command {
    const now = this.now();
    const file = this.outbox.get(to) ?? { v: 1, from: this.device, at: now, commands: [] };
    const c: Command = { id: `${this.device.id}.${now}.${++this.seq}`, at: now, fn, args };
    file.commands = [...file.commands.filter((x) => now - x.at < KEEP), c];
    file.at = now;
    this.outbox.set(to, file);
    return c;
  }

  /** The presses for `to` up to Disk. */
  async flush(to: string) {
    const file = this.outbox.get(to);
    if (file) await this.disk.write(commandFileOf(to, this.device.id), JSON.stringify(file));
  }

  /** Tells `to` this device still looks at it (it then looks for presses often); at most every STILL_WATCHING. */
  async watch(to: string) {
    const now = this.now();
    const file = this.outbox.get(to);
    if (file && now - file.at < STILL_WATCHING) return false;
    const next: CommandFile = { v: 1, from: this.device, at: now, commands: (file?.commands ?? []).filter((c) => now - c.at < KEEP) };
    this.outbox.set(to, next);
    await this.disk.write(commandFileOf(to, this.device.id), JSON.stringify(next));
    return true;
  }

  /** Tells `to` this device does not look at it any more (it stops looking for presses often at once). */
  async unwatch(to: string) {
    const file = this.outbox.get(to);
    if (!file) return;
    file.at = 0;
    await this.disk.write(commandFileOf(to, this.device.id), JSON.stringify(file));
  }

  /** Forgets the others (Disk disconnected). */
  clear() {
    this.theirs.clear();
    this.lans.clear();
    this.inbox.clear();
    this.outbox.clear();
  }

  private async readJson<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await this.disk.read(name)) as T;
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      console.warn(`[now] ${name} is not readable, left alone`, e);
      return null;
    }
  }
}
