// iPhone: the equalizer and the volume need Web Audio, which hears nothing of a stream from
// another origin without CORS (Yandex's CDN, on iOS). With processing on, a track is fetched
// whole through the native HTTP stack and played from memory (a blob is same-origin), as
// downloaded tracks are. An element routed through Web Audio stays routed, so the choice holds
// for the whole run: switching it takes a restart.

import { create } from 'zustand';
import { loadJson, storage, transport } from '../api/client.ts';
import { isIos } from '../ui/platform.ts';
import { audioType } from './offline.ts';

interface Prefs {
  /** Equalizer and volume on the iPhone (tracks load whole before they play). */
  processing: boolean;
  /** A volume slider on Now Playing, under play (needs processing). */
  volumeSlider: boolean;
}

const KEY = 'audio.processing';
export const useProcessing = create<Prefs>(() => loadJson<Prefs>(KEY, { processing: false, volumeSlider: false }));

/** Fixed when the app starts (see above). */
export const processingOn = isIos && useProcessing.getState().processing;

export function setProcessingPrefs(patch: Partial<Prefs>) {
  useProcessing.setState(patch);
  storage.setItem(KEY, JSON.stringify(useProcessing.getState()));
}

/** Blob URLs by track id: the playing one and the next, fetched ahead. */
const memory = new Map<string, Promise<string>>();

/** The track's stream, whole, as a same-origin URL. */
export function memoryUrl(id: string, url: string, codec: string): Promise<string> {
  let p = memory.get(id);
  if (!p) {
    p = transport.fetchBytes!(url).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: audioType(codec) })));
    p.catch(() => memory.delete(id));
    memory.set(id, p);
  }
  return p;
}

/** Frees every track but these (the playing one and the next). */
export function keepInMemory(ids: string[]) {
  for (const [id, p] of memory)
    if (!ids.includes(id)) {
      memory.delete(id);
      p.then(URL.revokeObjectURL, () => {});
    }
}
