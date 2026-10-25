// The iPhone's background downloads (ios/App/App/DownloadsPlugin.swift): iOS fetches
// the files even while Oni is in the background or locked, a few at a time in the list's order;
// the native side seals each with the library's key as it lands (or, without the key yet, leaves
// it unencrypted in a folder for the page to seal); this keeps the books. A list is written down whole at once (so a lock screen mid-way loses
// nothing), stream URLs are resolved a few at a time and handed to iOS, finished files are sealed
// into the offline library whenever the page runs, and whatever iOS dropped (an expired URL, a
// network error) is asked for again with a fresh URL, a few times at most.

import type { Track } from '../api/types.ts';
import type { KeyValueStore } from '../wave/history.ts';
import { trimTrack } from './recent.ts';

export interface BackgroundDeps {
  native: {
    enqueue(items: { id: string; url: string }[]): Promise<void>;
    /** Ids iOS is still working on. */
    running(): Promise<string[]>;
    cancel(ids: string[]): Promise<void>;
  };
  /** Files the native side has sealed already: moved into the library (`take`), no bytes read. */
  sealed?: {
    list(): Promise<{ id: string; size: number }[]>;
    take(id: string, track: Track, size: number, codec: string, bitrate: number): Promise<void>;
    remove(id: string): Promise<void>;
  };
  /** The folder iOS puts finished files in, by track id. */
  incoming: {
    list(): Promise<string[]>;
    read(id: string): Promise<ArrayBuffer>;
    remove(id: string): Promise<void>;
  };
  stream(id: string): Promise<{ url: string; codec: string; bitrate: number }>;
  keep(track: Track, audio: ArrayBuffer, codec: string, bitrate: number): Promise<void>;
  has(id: string): boolean;
  store: KeyValueStore;
}

interface Pending {
  track: Track;
  /** The list it was asked for with ("liked", "playlist:…"). */
  list: string;
  codec: string;
  bitrate: number;
  /** Handed to iOS (with a URL) at least once. */
  sent: boolean;
  tries: number;
  /** Its place in the queue. The books are an object keyed by track id, and numeric keys come out
   * sorted by number, not as added: lists went to iOS in a jumble (the user). */
  seq?: number;
}

const KEY = 'downloads.background';
const LISTS = 'downloads.background.lists';

/** A list being downloaded: its size (what is there already counted as done, as on its button)
 * and its name, for the progress in the shade and the Dynamic Island. */
interface ListInfo {
  total: number;
  title: string;
}
/** URLs resolved at once: Yandex refuses bursts. */
const CHUNK = 6;
/** Hand-overs per track before it counts as failed. */
const MAX_TRIES = 4;

export class BackgroundDownloads {
  private pending: Record<string, Pending>;
  private deps: BackgroundDeps;
  private listeners = new Set<() => void>();
  private sending: Promise<void> | null = null;
  /** Tracks given up on, by list, until the list is asked for again. */
  readonly failed: Record<string, number> = {};

  private lists: Record<string, ListInfo>;

  constructor(deps: BackgroundDeps) {
    this.deps = deps;
    const load = <T,>(key: string): T => {
      try {
        return JSON.parse(deps.store.getItem(key) || '{}');
      } catch {
        return {} as T;
      }
    };
    this.pending = load(KEY);
    this.lists = load(LISTS);
    this.seq = Math.max(0, ...Object.values(this.pending).map((p) => p.seq ?? 0)) + 1;
  }

  private seq: number;

  /** What is to go, in the order it was asked for. */
  private queue() {
    return Object.entries(this.pending).sort(([, a], [, b]) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  isPending(id: string | number) {
    return Boolean(this.pending[String(id)]);
  }

  /**
   * All the lists under way: done of total, counted as the lists' buttons count (what was there
   * before included). Lists that are through stay in it until the last one is, so the end reads
   * "502 of 502"; a new list starts a new count.
   */
  progress(): { done: number; total: number; title: string } {
    let done = 0;
    let total = 0;
    for (const [list, info] of Object.entries(this.lists)) {
      total += info.total;
      done += Math.max(0, info.total - this.pendingFor(list));
    }
    const names = Object.values(this.lists).map((l) => l.title);
    return { done, total, title: names.length === 1 ? names[0] : '' };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Tracks of this list still on their way. */
  pendingFor(list: string) {
    return Object.values(this.pending).filter((p) => p.list === list).length;
  }

  /** Writes the list down (in the caller's order: iOS takes them in it) and starts handing it to iOS. */
  async add(list: string, tracks: Track[], title = '') {
    delete this.failed[list];
    // A new count: lists that are through leave it.
    for (const l of Object.keys(this.lists)) if (!this.pendingFor(l)) delete this.lists[l];
    this.lists[list] = { total: tracks.filter((t) => t.available !== false).length, title };
    for (const t of tracks) {
      const id = String(t.id);
      if (t.available === false || this.deps.has(id) || this.pending[id]) continue;
      this.pending[id] = { track: trimTrack(t), list, codec: '', bitrate: 0, sent: false, tries: 0, seq: this.seq++ };
    }
    this.changed();
    await this.send();
  }

  /** Stops every list (the room for downloads is full). */
  async cancelAll() {
    const ids = Object.keys(this.pending);
    this.pending = {};
    this.lists = {};
    this.changed();
    await this.deps.native.cancel(ids);
  }

  /** Stops a list: iOS cancels what it has, the rest is forgotten. */
  async cancel(list: string) {
    const ids = Object.keys(this.pending).filter((id) => this.pending[id].list === list);
    for (const id of ids) delete this.pending[id];
    delete this.lists[list];
    this.changed();
    await this.deps.native.cancel(ids);
  }

  /** Takes what iOS has finished into the offline library: sealed files as they are, the rest sealed here. */
  async collect() {
    for (const { id, size } of (await this.deps.sealed?.list().catch(() => [])) ?? []) {
      const p = this.pending[id];
      try {
        if (p) await this.deps.sealed!.take(id, p.track, size, p.codec, p.bitrate);
        else await this.deps.sealed!.remove(id); // a cancelled list's
      } catch (e) {
        console.warn('background download: taking failed', id, e);
        continue;
      }
      if (p) {
        delete this.pending[id];
        this.changed();
      }
    }
    for (const id of await this.deps.incoming.list()) {
      const p = this.pending[id];
      try {
        if (p) await this.deps.keep(p.track, await this.deps.incoming.read(id), p.codec, p.bitrate);
      } catch (e) {
        console.warn('background download: keeping failed', id, e);
        continue;
      }
      await this.deps.incoming.remove(id).catch(() => {});
      if (p) {
        delete this.pending[id];
        this.changed();
      }
    }
  }

  /** On start and on return: collect, then hand iOS again whatever it no longer works on. */
  async resume() {
    await this.collect();
    const running = new Set(await this.deps.native.running());
    for (const p of Object.values(this.pending)) if (p.sent && !running.has(String(p.track.id))) p.sent = false;
    await this.send();
  }

  /** iOS dropped one (an expired URL, a network error) while the page runs. */
  async dropped(id: string) {
    const p = this.pending[id];
    if (!p) return;
    p.sent = false;
    await this.send();
  }

  /** Hands iOS the tracks not with it yet, a few URLs at a time; gives up on a track after a few tries. */
  private send(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = (async () => {
      for (;;) {
        const due = this.queue()
          .filter(([, p]) => !p.sent)
          .slice(0, CHUNK);
        if (!due.length) break;
        // Resolved together, handed over in the queue's order (not in the order Yandex answers).
        const resolved = await Promise.all(
          due.map(async ([id, p]) => {
            if (++p.tries > MAX_TRIES) {
              this.failed[p.list] = (this.failed[p.list] ?? 0) + 1;
              delete this.pending[id];
              return null;
            }
            try {
              const s = await this.deps.stream(id);
              Object.assign(p, { codec: s.codec, bitrate: s.bitrate, sent: true });
              return { id, url: s.url };
            } catch {
              return null; // left unsent: the next pass (or the next resume) tries again
            }
          }),
        );
        const items = resolved.filter((i): i is { id: string; url: string } => Boolean(i));
        if (items.length) await this.deps.native.enqueue(items);
        this.changed();
        // Nothing could be resolved this pass (no network?): stop until the next resume.
        if (!items.length && due.every(([id]) => this.pending[id] && !this.pending[id].sent)) break;
      }
    })().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private changed() {
    this.deps.store.setItem(KEY, JSON.stringify(this.pending));
    this.deps.store.setItem(LISTS, JSON.stringify(this.lists));
    for (const fn of this.listeners) fn();
  }
}
