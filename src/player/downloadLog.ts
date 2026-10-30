// Which downloads were asked for, by what and why (the user, 30.10.2026: tracks of a wave only heard
// once, on 25.10, kept downloading by themselves on the iPhone, a few at a time over days, and
// nothing in Oni's code chooses such tracks). Every ask and every arrival is written down here and
// goes with this device's file to Oni's folder on Yandex Disk (src/sync/devices.ts), so the next
// time the cause is read there, not guessed. `from`: where in the code the ask came (the bundle's
// places; a build of the same version with source maps names them).

import type { KeyValueStore } from '../wave/history.ts';

export interface DownloadLogEntry {
  at: number;
  /** `ask`: tracks handed to the downloads; `in`: one landed in the library. */
  kind: 'ask' | 'in';
  /** The list it was asked with ("own-offline", "track:<id>", "playlist:…", "mix:…"). */
  list: string;
  /** What made it: the user ("menu", "button") or Oni by itself ("own-offline", "new-like"). */
  why?: string;
  title?: string;
  ids: string[];
  from?: string[];
  v?: string;
}

const KEY = 'downloads.log';
/** Kept: enough for weeks of downloads, small in the device's file. */
const KEEP = 200;

export class DownloadLog {
  private entries: DownloadLogEntry[];
  private store: KeyValueStore;
  private now: () => number;
  private version: string;

  constructor(store: KeyValueStore, version = '', now = () => Date.now()) {
    this.store = store;
    this.version = version;
    this.now = now;
    try {
      const raw = JSON.parse(store.getItem(KEY) || '[]');
      this.entries = Array.isArray(raw) ? raw : [];
    } catch {
      this.entries = [];
    }
  }

  ask(list: string, ids: string[], why?: string, title?: string) {
    if (!ids.length) return;
    this.write({ at: this.now(), kind: 'ask', list, why, title: title || undefined, ids, from: callers(), v: this.version || undefined });
  }

  arrived(list: string, id: string) {
    this.write({ at: this.now(), kind: 'in', list, ids: [id] });
  }

  own(): DownloadLogEntry[] {
    return this.entries;
  }

  private write(e: DownloadLogEntry) {
    this.entries = [...this.entries, e].slice(-KEEP);
    this.store.setItem(KEY, JSON.stringify(this.entries));
  }
}

/** The calls that led here, without this file's own and the page's address. */
function callers(): string[] {
  const lines = (new Error().stack ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines
    .filter((l) => !/^Error\b/.test(l) && !/downloadLog/.test(l))
    .slice(0, 8)
    .map((l) => l.replace(/(capacitor|https?):\/\/[^/]+\//g, '').slice(0, 120));
}
