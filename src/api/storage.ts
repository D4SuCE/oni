// Where Oni keeps its data (history, the play log, the library, caches): IndexedDB, read whole into
// memory before the app starts, so reading stays at once as it was with localStorage. The page's
// localStorage holds about 5 MB on the iPhone: it was full, a night of plays was never kept, and the
// recommendations' cache let go to make room was made anew on every opening ("Made for you" slow:
// the user, 25.10.2026). The interface's own small settings ("ui.*") stay in localStorage, read there
// directly. Without IndexedDB (it failed to open) everything stays in localStorage as before.

const DB = 'oni';
const STORE = 'kv';
/** Kept in localStorage: read there directly, before anything is loaded (the language, the sidebar, …). */
const STAYS = (key: string) => key.startsWith('ui.');
/** Kept only to be quick: made again when gone (let go when localStorage is full). */
const CACHES = ['recs.v1'];

let db: IDBDatabase | null = null;
const memory = new Map<string, string>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });

/**
 * Before the app: everything kept in IndexedDB into memory, and what is still in localStorage (an
 * older Oni's, or a move cut short) moved there first, then removed from localStorage once kept.
 */
export async function loadStorage() {
  if (typeof indexedDB === 'undefined') return;
  try {
    const opened = await open();
    const moving: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && !STAYS(key)) moving.push([key, localStorage.getItem(key) ?? '']);
    }
    if (moving.length) {
      const tx = opened.transaction(STORE, 'readwrite');
      for (const [key, value] of moving) tx.objectStore(STORE).put(value, key);
      await done(tx);
    }
    const tx = opened.transaction(STORE, 'readonly');
    const keys = tx.objectStore(STORE).getAllKeys();
    const values = tx.objectStore(STORE).getAll();
    await done(tx);
    keys.result.forEach((key, i) => memory.set(String(key), String(values.result[i])));
    // Kept in IndexedDB now: localStorage gets its room back.
    for (const [key] of moving) localStorage.removeItem(key);
    db = opened;
    if (moving.length) console.info(`[storage] ${moving.length} entries moved to IndexedDB`);
  } catch (e) {
    memory.clear();
    console.warn('[storage] IndexedDB unavailable, localStorage it is', e);
  }
}

/** Never throws: a broken or full storage must not crash the app. */
export const storage = {
  getItem(key: string): string | null {
    if (db && !STAYS(key)) return memory.get(key) ?? null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    if (db && !STAYS(key)) {
      memory.set(key, value);
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.onerror = () => console.warn(`[storage] ${key} not kept`, tx.error);
      } catch (e) {
        console.warn(`[storage] ${key} not kept`, e);
      }
      return;
    }
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Full: what is only a cache makes room, and it is tried again (it went by silently, and a
      // night of plays was never kept on the phone: the user, 25.10.2026).
      for (const cache of CACHES) {
        if (cache === key) continue;
        try {
          localStorage.removeItem(cache);
          localStorage.setItem(key, value);
          console.warn(`[storage] full: ${cache} let go for ${key}`);
          return;
        } catch {
          /* still full: the next one */
        }
      }
      console.warn(`[storage] ${key} not kept (${value.length} characters)`, e);
    }
  },
  removeItem(key: string) {
    if (db && !STAYS(key)) {
      memory.delete(key);
      try {
        db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
      } catch {
        /* gone with the page */
      }
      return;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* unavailable */
    }
  },
  /** Where the data is: 'indexeddb' or 'localstorage' (for the tests). */
  get kind() {
    return db ? 'indexeddb' : 'localstorage';
  },
};
