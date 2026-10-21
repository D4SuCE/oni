// Downloaded tracks ("Download" in the track menu), as in the official app: the audio is kept in
// the app's own folder, encrypted (AES-GCM, with a key made once and kept in the app's storage),
// so it plays in Oni without a network but is not a music file anyone can take elsewhere.
// File storage and fetching are the shell's (Transport.files / fetchBytes); this module keeps
// the index of what is downloaded and does the crypto.

import { fromBase64, toBase64 } from '../api/bytes.ts';
import type { Track } from '../api/types.ts';
import type { KeyValueStore } from '../wave/history.ts';
import { trimTrack } from './recent.ts';

export interface OfflineFiles {
  write(name: string, data: ArrayBuffer): Promise<void>;
  read(name: string): Promise<ArrayBuffer>;
  remove(name: string): Promise<void>;
  list(): Promise<{ name: string; size: number }[]>;
}

export interface OfflineDeps {
  files: OfflineFiles;
  /** The bytes behind a URL, fetched by the shell (the audio CDN sends no CORS headers). */
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** Where the track's audio is right now. */
  stream(trackId: string): Promise<{ url: string; codec: string; bitrate: number }>;
  store: KeyValueStore;
  crypto: Crypto;
}

export interface OfflineEntry {
  track: Track;
  /** Bytes on disk. */
  size: number;
  /** ms epoch when it was downloaded. */
  at: number;
  codec: string;
  bitrate: number;
}

const INDEX = 'offline.index.v1';
const KEY = 'offline.key.v1';
const IV = 12;

const fileName = (id: string | number) => `${id}.oni`;

/** The type the <audio> element gets for a codec Yandex names. */
export function audioType(codec: string) {
  if (/mp4/.test(codec)) return 'audio/mp4';
  if (/flac/.test(codec)) return 'audio/flac';
  if (/aac/.test(codec)) return 'audio/aac';
  return 'audio/mpeg';
}

export class OfflineLibrary {
  private index: Record<string, OfflineEntry>;
  private key: Promise<CryptoKey> | null = null;
  private busy = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();
  private deps: OfflineDeps;

  constructor(deps: OfflineDeps) {
    this.deps = deps;
    try {
      this.index = JSON.parse(deps.store.getItem(INDEX) || '{}');
    } catch {
      this.index = {};
    }
  }

  private changed() {
    this.deps.store.setItem(INDEX, JSON.stringify(this.index));
    for (const fn of this.listeners) fn();
  }

  /** Called after every change (a download starts or ends, a track is removed). */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private cryptoKey() {
    this.key ??= (async () => {
      let raw = this.deps.store.getItem(KEY);
      if (!raw) {
        raw = toBase64(this.deps.crypto.getRandomValues(new Uint8Array(32)));
        this.deps.store.setItem(KEY, raw);
      }
      return this.deps.crypto.subtle.importKey('raw', fromBase64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
    })();
    return this.key;
  }

  has(id: string | number) {
    return Boolean(this.index[String(id)]);
  }

  isDownloading(id: string | number) {
    return this.busy.has(String(id));
  }

  /** Newest first. */
  entries(): OfflineEntry[] {
    return Object.values(this.index).sort((a, b) => b.at - a.at);
  }

  totalSize() {
    return Object.values(this.index).reduce((n, e) => n + e.size, 0);
  }

  /** Downloads one track; a second call while it runs waits for the same download. */
  download(track: Track): Promise<void> {
    const id = String(track.id);
    if (this.index[id]) return Promise.resolve();
    const running = this.busy.get(id);
    if (running) return running;
    const job = (async () => {
      const { url, codec, bitrate } = await this.deps.stream(id);
      const audio = await this.deps.fetchBytes(url);
      const iv = this.deps.crypto.getRandomValues(new Uint8Array(IV));
      const sealed = new Uint8Array(await this.deps.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.cryptoKey(), audio));
      const file = new Uint8Array(IV + sealed.length);
      file.set(iv);
      file.set(sealed, IV);
      await this.deps.files.write(fileName(id), file.buffer);
      this.index[id] = { track: trimTrack(track), size: file.length, at: Date.now(), codec, bitrate };
    })().finally(() => {
      this.busy.delete(id);
      this.changed();
    });
    this.busy.set(id, job);
    this.changed();
    return job;
  }

  /**
   * Downloads a list, a few at a time, skipping what is already there.
   * `progress(done, total)` after each one; resolves with how many failed.
   */
  /**
   * Downloads in the order given what is not there yet. Progress counts the whole list, the part
   * already downloaded included, so a resumed download shows where it is. `stop` ends it after
   * the tracks under way.
   */
  async downloadAll(tracks: Track[], progress?: (done: number, total: number) => void, parallel = 2, stop?: () => boolean): Promise<number> {
    const playable = tracks.filter((t) => t.available !== false);
    const todo = playable.filter((t) => !this.has(t.id));
    let done = playable.length - todo.length;
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !stop?.()) {
        const t = todo[next++];
        try {
          await this.download(t);
        } catch {
          failed++;
        }
        progress?.(++done, playable.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, worker));
    return failed;
  }

  /** The decrypted audio, ready for an <audio> element. */
  async open(id: string | number): Promise<{ blob: Blob; entry: OfflineEntry }> {
    const entry = this.index[String(id)];
    if (!entry) throw new Error('not downloaded');
    const file = new Uint8Array(await this.deps.files.read(fileName(id)));
    const audio = await this.deps.crypto.subtle.decrypt({ name: 'AES-GCM', iv: file.subarray(0, IV) }, await this.cryptoKey(), file.subarray(IV));
    return { blob: new Blob([audio], { type: audioType(entry.codec) }), entry };
  }

  async remove(id: string | number) {
    if (!this.index[String(id)]) return;
    delete this.index[String(id)];
    this.changed();
    await this.deps.files.remove(fileName(id)).catch(() => {});
  }

  async removeAll() {
    const ids = Object.keys(this.index);
    this.index = {};
    this.changed();
    await Promise.all(ids.map((id) => this.deps.files.remove(fileName(id)).catch(() => {})));
  }

  /** Drops index entries whose file is gone, and files nothing points to (an interrupted download). */
  async reconcile() {
    const files = await this.deps.files.list().catch(() => null);
    if (!files) return;
    const onDisk = new Set(files.map((f) => f.name));
    let changed = false;
    for (const id of Object.keys(this.index)) {
      if (!onDisk.has(fileName(id))) {
        delete this.index[id];
        changed = true;
      }
    }
    for (const f of files) {
      const id = f.name.replace(/\.oni$/, '');
      if (!this.index[id] && !this.busy.has(id)) await this.deps.files.remove(f.name).catch(() => {});
    }
    if (changed) this.changed();
  }
}
