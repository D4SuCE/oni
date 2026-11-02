// What happened to the sound on the iPhone and what iOS said then (the user, 2.11.2026: VK's video
// without sound paused the music, also past a fix made from what iOS's documentation promises). What
// a real app does is seen only on the real phone: the native player tells of every play, pause and
// change of other apps' sound, and it goes with this device's file to Oni's folder on Yandex Disk
// (src/sync/devices.ts), so the next time the answer is read there, not guessed.

import type { KeyValueStore } from '../wave/history.ts';

export interface SoundLogEntry {
  at: number;
  /** `play`, `halt` (detail: who), `others`, `interrupted`, `interruption-ended`, `hint`, `route`. */
  kind: string;
  detail?: string;
  /** isOtherAudioPlaying. */
  others: boolean;
  /** secondaryAudioShouldBeSilencedHint. */
  taking: boolean;
  /** Whether Oni played at the time. */
  playing: boolean;
  v?: string;
}

const KEY = 'sound.log';
/** Kept: some days of listening, small in the device's file. */
const KEEP = 300;

export class SoundLog {
  private entries: SoundLogEntry[];
  private store: KeyValueStore;
  private version: string;

  constructor(store: KeyValueStore, version = '') {
    this.store = store;
    this.version = version;
    try {
      const raw = JSON.parse(store.getItem(KEY) || '[]');
      this.entries = Array.isArray(raw) ? raw : [];
    } catch {
      this.entries = [];
    }
  }

  add(e: SoundLogEntry) {
    this.entries = [...this.entries, { ...e, detail: e.detail || undefined, v: this.version || undefined }].slice(-KEEP);
    this.store.setItem(KEY, JSON.stringify(this.entries));
  }

  own(): SoundLogEntry[] {
    return this.entries;
  }
}
