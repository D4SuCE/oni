// The shared history (the user: "one history of Oni for the account, PC and phone"): every device
// keeps its own file in Oni's folder on Yandex Disk, `device-<id>.json`, with only what it heard
// itself, and reads the others'. Nothing is overwritten by another device, so there is nothing to
// resolve; another device's plays are a layer read beside this one's (wave/history.ts, playLog.ts,
// recent.ts), never saved here nor sent back.

import type { HistoryEntry } from '../wave/history.ts';
import type { DeviceLog } from '../player/playLog.ts';
import type { RecentPlay } from '../player/recent.ts';
import type { DiskLike } from './disk.ts';

export interface Device {
  id: string;
  /** 'electron' (Windows) or 'ios', named in the interface language when shown. */
  platform: string;
}

export interface DeviceFile {
  v: 1;
  device: Device;
  /** When it was written, ms epoch. */
  at: number;
  history: Record<string, HistoryEntry>;
  log: DeviceLog;
  recent: RecentPlay[];
}

/** The parts of this device's memory that are shared. */
export interface Shared {
  history: { own(): Record<string, HistoryEntry>; setRemote(devices: Record<string, HistoryEntry>[]): void };
  playLog: { own(): DeviceLog; setRemote(devices: DeviceLog[]): void };
  recent: { own(): RecentPlay[]; setRemote(plays: RecentPlay[]): void };
}

const PREFIX = 'device-';
export const fileOf = (id: string) => `${PREFIX}${id}.json`;

export class DeviceSync {
  /** The other devices' files as last read, by file name. */
  private theirs = new Map<string, { modified: string; file: DeviceFile }>();
  /** What this device last sent (without its time): unchanged, it is not sent again. */
  private sent = '';

  private disk: DiskLike;
  private shared: Shared;
  readonly device: Device;
  private now: () => number;

  constructor(disk: DiskLike, shared: Shared, device: Device, now = () => Date.now()) {
    this.disk = disk;
    this.shared = shared;
    this.device = device;
    this.now = now;
  }

  get fileName() {
    return fileOf(this.device.id);
  }

  /** The other devices, as last read. */
  devices(): { device: Device; at: number }[] {
    return [...this.theirs.values()].map(({ file }) => ({ device: file.device, at: file.at }));
  }

  /** Sends this device's file if anything changed since the last time; true when sent. */
  async push(): Promise<boolean> {
    const body = { history: this.shared.history.own(), log: this.shared.playLog.own(), recent: this.shared.recent.own() };
    const key = JSON.stringify(body);
    if (key === this.sent) return false;
    const file: DeviceFile = { v: 1, device: this.device, at: this.now(), ...body };
    await this.disk.write(this.fileName, JSON.stringify(file));
    this.sent = key;
    return true;
  }

  /** Reads the files changed since the last time, and lays the other devices beside this one. */
  async pull(): Promise<void> {
    const listed = (await this.disk.list()).filter((f) => f.name.startsWith(PREFIX) && f.name.endsWith('.json') && f.name !== this.fileName);
    const names = new Set(listed.map((f) => f.name));
    for (const name of this.theirs.keys()) if (!names.has(name)) this.theirs.delete(name);
    for (const f of listed) {
      if (this.theirs.get(f.name)?.modified === f.modified) continue;
      try {
        const file = JSON.parse(await this.disk.read(f.name)) as DeviceFile;
        // A file of a later Oni (another format) or a broken one is left alone.
        if (file?.v !== 1 || !file.device || file.device.id === this.device.id) continue;
        this.theirs.set(f.name, { modified: f.modified, file });
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        console.warn(`[sync] ${f.name} is not readable, left alone`, e); // in the log, not silently
      }
    }
    this.apply();
  }

  /** Forgets the other devices (Disk disconnected). */
  clear() {
    this.theirs.clear();
    this.sent = '';
    this.apply();
  }

  private apply() {
    const files = [...this.theirs.values()].map((x) => x.file);
    this.shared.history.setRemote(files.map((f) => f.history ?? {}));
    this.shared.playLog.setRemote(files.map((f) => f.log ?? { plays: [], tracks: {} }));
    this.shared.recent.setRemote(files.flatMap((f) => (f.recent ?? []).map((p) => ({ ...p, device: f.device.platform }))));
  }
}
