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
  /** The track's cover (one size, ~30 KB), kept beside it so it shows with no network too. */
  fetchCover?(track: Track): Promise<ArrayBuffer | null>;
}

export interface OfflineEntry {
  track: Track;
  /** Bytes on disk. */
  size: number;
  /** ms epoch when it was downloaded. */
  at: number;
  codec: string;
  bitrate: number;
  /** Its cover is kept too (`<id>.jpg`). */
  cover?: boolean;
}

const INDEX = 'offline.index.v1';
const KEY = 'offline.key.v1';
const IV = 12;

const fileName = (id: string | number) => `${id}.oni`;
const coverName = (id: string | number) => `${id}.jpg`;

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
  /** Covers read back for the offline mode, by id: object URLs, made once. */
  private covers = new Map<string, Promise<string | null>>();
  /** Tracks someone else is putting in place (the iPhone's background downloads): their files are
   * not leftovers, even before they are in the index. */
  protect: (id: string) => boolean = () => false;

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

  entry(id: string | number): OfflineEntry | undefined {
    return this.index[String(id)];
  }

  /** The key, base64, for the iPhone's native side: it seals background downloads and opens
   * downloaded tracks itself (AES-GCM, the same file: nonce, then ciphertext and tag), so the
   * audio never crosses the bridge as text. */
  async rawKey() {
    await this.cryptoKey();
    return this.deps.store.getItem(KEY)!;
  }

  /** A file already sealed with this key and put in place by someone else (the iPhone's native
   * side): only its index entry is new. */
  adopt(track: Track, size: number, codec: string, bitrate: number) {
    this.index[String(track.id)] = { track: trimTrack(track), size, at: Date.now(), codec, bitrate };
    this.changed();
    void this.saveCover(track);
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
      await this.seal(track, await this.deps.fetchBytes(url), codec, bitrate);
      await this.saveCover(track);
    })().finally(() => {
      this.busy.delete(id);
      this.changed();
    });
    this.busy.set(id, job);
    this.changed();
    return job;
  }

  /**
   * Keeps audio fetched elsewhere (the iPhone's background downloads): encrypted on disk and in
   * the index, as `download` keeps what it fetches.
   */
  async keep(track: Track, audio: ArrayBuffer, codec: string, bitrate: number) {
    await this.seal(track, audio, codec, bitrate);
    this.changed();
    await this.saveCover(track);
  }

  /** Keeps the track's cover beside it; without one (or with no network) it simply has none. */
  private async saveCover(track: Track) {
    const id = String(track.id);
    if (!this.deps.fetchCover || !this.index[id] || this.index[id].cover) return;
    const data = await this.deps.fetchCover(track).catch(() => null);
    if (!data || !this.index[id]) return;
    await this.deps.files.write(coverName(id), data);
    this.index[id].cover = true;
    this.changed();
  }

  /** Covers for tracks downloaded before covers were kept, a few at a time (with a network). */
  async fillCovers(parallel = 3) {
    const todo = Object.values(this.index).filter((e) => !e.cover).map((e) => e.track);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) await this.saveCover(todo[next++]).catch(() => {});
    };
    await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, worker));
  }

  /** The kept cover, for an <img>; null where there is none. */
  coverUrl(id: string | number): Promise<string | null> {
    const key = String(id);
    if (!this.index[key]?.cover) return Promise.resolve(null);
    let url = this.covers.get(key);
    if (!url) {
      url = this.deps.files
        .read(coverName(key))
        .then((data) => URL.createObjectURL(new Blob([data], { type: 'image/jpeg' })))
        .catch(() => null);
      this.covers.set(key, url);
    }
    return url;
  }

  private async seal(track: Track, audio: ArrayBuffer, codec: string, bitrate: number) {
    const id = String(track.id);
    const iv = this.deps.crypto.getRandomValues(new Uint8Array(IV));
    const sealed = new Uint8Array(await this.deps.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.cryptoKey(), audio));
    const file = new Uint8Array(IV + sealed.length);
    file.set(iv);
    file.set(sealed, IV);
    await this.deps.files.write(fileName(id), file.buffer);
    this.index[id] = { track: trimTrack(track), size: file.length, at: Date.now(), codec, bitrate };
  }

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
    const cover = this.index[String(id)].cover;
    delete this.index[String(id)];
    this.changed();
    await this.deps.files.remove(fileName(id)).catch(() => {});
    if (cover) await this.deps.files.remove(coverName(id)).catch(() => {});
  }

  async removeAll() {
    const ids = Object.keys(this.index);
    const covers = ids.filter((id) => this.index[id].cover);
    this.index = {};
    this.changed();
    await Promise.all(ids.map((id) => this.deps.files.remove(fileName(id)).catch(() => {})));
    await Promise.all(covers.map((id) => this.deps.files.remove(coverName(id)).catch(() => {})));
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
      } else if (this.index[id].cover && !onDisk.has(coverName(id))) {
        this.index[id].cover = false;
        changed = true;
      }
    }
    for (const f of files) {
      const id = f.name.replace(/\.(oni|jpg)$/, '');
      if (!this.index[id] && !this.busy.has(id) && !this.protect(id)) await this.deps.files.remove(f.name).catch(() => {});
    }
    if (changed) this.changed();
  }
}
