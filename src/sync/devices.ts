// The shared history (the user: "one history of Oni for the account, PC and phone"): every device
// keeps its own file in Oni's folder on Yandex Disk, `device-<id>.json`, with only what it heard
// itself, and reads the others'. Nothing is overwritten by another device, so there is nothing to
// resolve; another device's plays are a layer read beside this one's (wave/history.ts, playLog.ts,
// recent.ts), never saved here nor sent back.

import type { HistoryEntry } from '../wave/history.ts';
import type { DeviceLog } from '../player/playLog.ts';
import type { RecentPlay } from '../player/recent.ts';
import type { SharedFeedback } from '../recs/feedback.ts';
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
  /** "Skipped", hidden from the mixes, demoted artists, brought back (recs/feedback.ts); not in older files. */
  feedback?: SharedFeedback;
}

/** The parts of this device's memory that are shared. */
export interface Shared {
  history: { own(): Record<string, HistoryEntry>; setRemote(devices: Record<string, HistoryEntry>[]): void; restore(entries: Record<string, HistoryEntry>): void };
  playLog: { own(): DeviceLog; setRemote(devices: DeviceLog[]): void; restore(log: DeviceLog): void };
  recent: { own(): RecentPlay[]; setRemote(plays: RecentPlay[]): void; restore(plays: RecentPlay[]): void };
  /** Decisions, the latest winning: the other devices' and this one's own file are read alike. */
  feedback?: { own(): SharedFeedback; setRemote(devices: SharedFeedback[]): void };
}

const PREFIX = 'device-';
const fileOf = (id: string) => `${PREFIX}${id}.json`;

export class DeviceSync {
  /** The other devices' files as last read, by file name. */
  private theirs = new Map<string, { modified: string; file: DeviceFile }>();
  /** What this device last sent (without its time): unchanged, it is not sent again. */
  private sent = '';
  /** This device's own file on Disk has been read (and what this one lost taken back from it). Until
   * then nothing is sent: what is here may be less than the file there (the user, 25.10.2026: the
   * phone's storage lost a night of plays, Oni started anew and sent the rest over the file). */
  private restored = false;

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
    if (!this.restored) return false;
    const body = { history: this.shared.history.own(), log: this.shared.playLog.own(), recent: this.shared.recent.own(), feedback: this.shared.feedback?.own() };
    const key = JSON.stringify(body);
    if (key === this.sent) return false;
    const file: DeviceFile = { v: 1, device: this.device, at: this.now(), ...body };
    await this.disk.write(this.fileName, JSON.stringify(file));
    this.sent = key;
    return true;
  }

  /** Reads the files changed since the last time, and lays the other devices beside this one. */
  async pull(): Promise<void> {
    const all = await this.disk.list();
    if (!this.restored) await this.restore(all.some((f) => f.name === this.fileName));
    const listed = all.filter((f) => f.name.startsWith(PREFIX) && f.name.endsWith('.json') && f.name !== this.fileName);
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

  /** This device's own file, once: what it keeps and this one lost comes back here. */
  private async restore(exists: boolean) {
    if (exists) {
      let file: DeviceFile | null = null;
      try {
        file = JSON.parse(await this.disk.read(this.fileName)) as DeviceFile;
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e; // no network: not read, nothing sent; the next round tries again
        console.warn(`[sync] ${this.fileName} is not readable, left alone`, e);
      }
      if (file?.v === 1 && file.device?.id === this.device.id) {
        this.shared.history.restore(file.history ?? {});
        this.shared.playLog.restore(file.log ?? { plays: [], tracks: {} });
        this.shared.recent.restore(file.recent ?? []);
        if (file.feedback) this.shared.feedback?.setRemote([file.feedback]);
      }
    }
    this.restored = true;
  }

  /** Forgets the other devices (Disk disconnected). */
  clear() {
    this.theirs.clear();
    this.sent = '';
    this.restored = false;
    this.apply();
  }

  private apply() {
    const files = [...this.theirs.values()].map((x) => x.file);
    this.shared.history.setRemote(files.map((f) => f.history ?? {}));
    this.shared.playLog.setRemote(files.map((f) => f.log ?? { plays: [], tracks: {} }));
    this.shared.recent.setRemote(files.flatMap((f) => (f.recent ?? []).map((p) => ({ ...p, device: f.device.platform }))));
    this.shared.feedback?.setRemote(files.flatMap((f) => (f.feedback ? [f.feedback] : [])));
  }
}
