// The iPhone's side of background downloads: the OniDownloads plugin, its folders of finished
// files, and when to look at them (start, return to the app, each file iOS reports done).
// The native side seals each file with the library's key as it lands (the page hands it the key),
// so no audio crosses the bridge as text; it shows the progress in the Dynamic Island and on the
// lock screen (a Live Activity), or as a quiet notification where those are off.

import { Directory, Filesystem } from '@capacitor/filesystem';
import { registerPlugin } from '@capacitor/core';
import { create } from 'zustand';
import { api, storage } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { fromBase64 } from '../api/bytes.ts';
import { BackgroundDownloads } from './backgroundDownloads.ts';
import { downloadLog, offline, usePlayer } from './player.ts';

interface DownloadsPlugin {
  enqueue(options: { items: { id: string; url: string }[] }): Promise<void>;
  running(): Promise<{ ids: string[] }>;
  cancel(options: { ids: string[] }): Promise<void>;
  /** The key files are sealed with (base64, AES-256-GCM); kept in the Keychain for launches in the background. */
  setKey(options: { key: string }): Promise<void>;
  notifications(options: { progress: string; done: string; title: string; stale: string }): Promise<{ granted: boolean }>;
  /** The lists' count, from the page; the native side moves it on by itself while the page sleeps. */
  progress(options: { done: number; total: number; title: string }): Promise<void>;
  /** For the smoke test: the Live Activity and the count. */
  state(): Promise<{ activity: boolean; done: number; total: number; queued: number; running: number }>;
  /** The network now: `expensive` mobile data or a hotspot, `constrained` Low Data Mode. */
  network(): Promise<{ satisfied: boolean; expensive: boolean; constrained: boolean }>;
  addListener(event: 'done' | 'failed', cb: (e: { id: string }) => void): Promise<unknown>;
  addListener(event: 'progress', cb: (e: { id: string; written: number; total: number }) => void): Promise<unknown>;
}

export const OniDownloads = registerPlugin<DownloadsPlugin>('OniDownloads');
const INCOMING = { path: 'oni-incoming', directory: Directory.Library };
const SEALED = { path: 'oni-sealed', directory: Directory.Library };
/** The library's folder (src/api/capacitor.ts, transport.files). */
const LIBRARY = 'offline';

/** How far each track iOS is fetching is, 0…1, for the ring on its row. */
export const useTrackProgress = create<Record<string, number>>(() => ({}));
const forget = (id: string) =>
  useTrackProgress.setState((s) => {
    if (!(id in s)) return s;
    const { [id]: _, ...rest } = s;
    return rest;
  }, true);

export function iosBackgroundDownloads() {
  const lib = offline!;
  const bg = new BackgroundDownloads({
    native: {
      enqueue: (items) => OniDownloads.enqueue({ items }),
      running: async () => (await OniDownloads.running()).ids,
      cancel: (ids) => OniDownloads.cancel({ ids }),
    },
    sealed: {
      list: async () =>
        (await Filesystem.readdir(SEALED).catch(() => ({ files: [] }))).files
          .filter((f) => f.name.endsWith('.oni'))
          .map((f) => ({ id: f.name.replace(/\.oni$/, ''), size: f.size })),
      take: async (id, track, size, codec, bitrate) => {
        // A move within the app's Library: the file is already what the library keeps.
        await Filesystem.rename({ from: `${SEALED.path}/${id}.oni`, to: `${LIBRARY}/${id}.oni`, directory: Directory.Library, toDirectory: Directory.Library });
        lib.adopt(track, size, codec, bitrate);
      },
      remove: (id) => Filesystem.deleteFile({ ...SEALED, path: `${SEALED.path}/${id}.oni` }),
    },
    incoming: {
      list: async () => (await Filesystem.readdir(INCOMING).catch(() => ({ files: [] }))).files.map((f) => f.name),
      read: async (id) => {
        const { data } = await Filesystem.readFile({ ...INCOMING, path: `${INCOMING.path}/${id}` });
        return fromBase64(data as string).buffer as ArrayBuffer;
      },
      remove: (id) => Filesystem.deleteFile({ ...INCOMING, path: `${INCOMING.path}/${id}` }),
    },
    stream: (id) => api.stream(id, usePlayer.getState().quality),
    keep: (track, audio, codec, bitrate) => lib.keep(track, audio, codec, bitrate),
    has: (id) => lib.has(id),
    store: storage,
    log: downloadLog,
  });
  lib.protect = (id) => bg.isPending(id);
  // The library's folder must be there for the first move into it.
  Filesystem.mkdir({ path: LIBRARY, directory: Directory.Library, recursive: true }).catch(() => {});
  lib.rawKey().then((key) => OniDownloads.setKey({ key })).catch((e) => console.warn('downloads: no key for the native side', e));
  OniDownloads.addListener('done', ({ id }) => {
    forget(id);
    bg.collect();
  });
  OniDownloads.addListener('failed', ({ id }) => {
    forget(id);
    bg.dropped(id);
  });
  OniDownloads.addListener('progress', ({ id, written, total }) => total > 0 && useTrackProgress.setState({ [id]: Math.min(1, written / total) }));
  // The count goes to the native side whenever it changes (the Live Activity, the notification),
  // "nothing left" too: a cancelled download closes them (they kept the old numbers).
  let last = '';
  bg.subscribe(() => {
    const p = bg.progress();
    const key = `${p.done}/${p.total}/${p.title}`;
    if (key === last || (!p.total && !last)) return;
    last = p.total ? key : '';
    OniDownloads.progress({ ...p, title: p.title || tr().downloads.shadeTitle }).catch(() => {});
  });
  document.addEventListener('visibilitychange', () => !document.hidden && bg.resume());
  bg.resume();
  // Lists still going from before: the native side gets its texts again (it keeps them in memory).
  if (bg.progress().total) showProgressInShade();
  return bg;
}

let asked = false;
/** Progress outside the app, kept by the native side (it runs with the screen locked): asked
 * for once, when the first list is downloaded (iOS's permission prompt then). */
export function showProgressInShade() {
  if (asked) return;
  asked = true;
  const d = tr().downloads;
  OniDownloads.notifications({ progress: d.shadeProgress, done: d.shadeDone, title: d.shadeTitle, stale: d.shadeStale }).catch(() => {});
}
