// The iPhone's side of background downloads: the OniDownloads plugin, its folder of finished
// files, and when to look at them (start, return to the app, each file iOS reports done).

import { Directory, Filesystem } from '@capacitor/filesystem';
import { registerPlugin } from '@capacitor/core';
import { api, storage } from '../api/client.ts';
import { fromBase64 } from '../api/bytes.ts';
import { BackgroundDownloads } from './backgroundDownloads.ts';
import { offline, usePlayer } from './player.ts';

interface DownloadsPlugin {
  enqueue(options: { items: { id: string; url: string }[] }): Promise<void>;
  running(): Promise<{ ids: string[] }>;
  cancel(options: { ids: string[] }): Promise<void>;
  addListener(event: 'done' | 'failed', cb: (e: { id: string }) => void): Promise<unknown>;
}

const OniDownloads = registerPlugin<DownloadsPlugin>('OniDownloads');
const FOLDER = { path: 'oni-incoming', directory: Directory.Library };

export function iosBackgroundDownloads() {
  const lib = offline!;
  const bg = new BackgroundDownloads({
    native: {
      enqueue: (items) => OniDownloads.enqueue({ items }),
      running: async () => (await OniDownloads.running()).ids,
      cancel: (ids) => OniDownloads.cancel({ ids }),
    },
    incoming: {
      list: async () => (await Filesystem.readdir(FOLDER).catch(() => ({ files: [] }))).files.map((f) => f.name),
      read: async (id) => {
        const { data } = await Filesystem.readFile({ ...FOLDER, path: `${FOLDER.path}/${id}` });
        return fromBase64(data as string).buffer as ArrayBuffer;
      },
      remove: (id) => Filesystem.deleteFile({ ...FOLDER, path: `${FOLDER.path}/${id}` }),
    },
    stream: (id) => api.stream(id, usePlayer.getState().quality),
    keep: (track, audio, codec, bitrate) => lib.keep(track, audio, codec, bitrate),
    has: (id) => lib.has(id),
    store: storage,
  });
  OniDownloads.addListener('done', () => bg.collect());
  OniDownloads.addListener('failed', ({ id }) => bg.dropped(id));
  document.addEventListener('visibilitychange', () => !document.hidden && bg.resume());
  bg.resume();
  return bg;
}
