// The iPhone's background downloads (DownloadsPlugin in ios/App/App/OniBridge.swift): iOS fetches
// the files even while Oni is in the background or locked, and they land unencrypted in a folder;
// this keeps the books. A list is written down whole at once (so a lock screen mid-way loses
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
}

const KEY = 'downloads.background';
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

  constructor(deps: BackgroundDeps) {
    this.deps = deps;
    try {
      this.pending = JSON.parse(deps.store.getItem(KEY) || '{}');
    } catch {
      this.pending = {};
    }
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Tracks of this list still on their way. */
  pendingFor(list: string) {
    return Object.values(this.pending).filter((p) => p.list === list).length;
  }

  /** Writes the list down (oldest first is the caller's order) and starts handing it to iOS. */
  async add(list: string, tracks: Track[]) {
    delete this.failed[list];
    for (const t of tracks) {
      const id = String(t.id);
      if (t.available === false || this.deps.has(id) || this.pending[id]) continue;
      this.pending[id] = { track: trimTrack(t), list, codec: '', bitrate: 0, sent: false, tries: 0 };
    }
    this.changed();
    await this.send();
  }

  /** Stops a list: iOS cancels what it has, the rest is forgotten. */
  async cancel(list: string) {
    const ids = Object.keys(this.pending).filter((id) => this.pending[id].list === list);
    for (const id of ids) delete this.pending[id];
    this.changed();
    await this.deps.native.cancel(ids);
  }

  /** Seals what iOS has finished into the offline library. */
  async collect() {
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
        const due = Object.entries(this.pending)
          .filter(([, p]) => !p.sent)
          .slice(0, CHUNK);
        if (!due.length) break;
        const items: { id: string; url: string }[] = [];
        await Promise.all(
          due.map(async ([id, p]) => {
            if (++p.tries > MAX_TRIES) {
              this.failed[p.list] = (this.failed[p.list] ?? 0) + 1;
              delete this.pending[id];
              return;
            }
            try {
              const s = await this.deps.stream(id);
              Object.assign(p, { codec: s.codec, bitrate: s.bitrate, sent: true });
              items.push({ id, url: s.url });
            } catch {
              /* left unsent: the next pass (or the next resume) tries again */
            }
          }),
        );
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
    for (const fn of this.listeners) fn();
  }
}
