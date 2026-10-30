// Tracks the user took out of the downloads by hand (the user, 30.10.2026: removed tracks came back
// by themselves): Oni's own downloads ("Keep mine offline", new likes) leave them alone for good;
// downloading one by hand (its menu, a list's Download) takes it back.

import type { KeyValueStore } from '../wave/history.ts';

const KEY = 'downloads.removedByHand';

export class RemovedDownloads {
  private ids: Set<string>;
  private store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
    try {
      const raw = JSON.parse(store.getItem(KEY) || '[]');
      this.ids = new Set(Array.isArray(raw) ? raw.map(String) : []);
    } catch {
      this.ids = new Set();
    }
  }

  has(id: string | number) {
    return this.ids.has(String(id));
  }

  add(id: string | number) {
    this.ids.add(String(id));
    this.save();
  }

  /** Downloaded by the user's own hand: Oni may keep these again. */
  wantedAgain(ids: (string | number)[]) {
    let changed = false;
    for (const id of ids) changed = this.ids.delete(String(id)) || changed;
    if (changed) this.save();
  }

  private save() {
    this.store.setItem(KEY, JSON.stringify([...this.ids]));
  }
}
