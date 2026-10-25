import { useLang } from '../i18n.ts';
import { platformTransport } from './transport.ts';
import { YandexMusic } from './yandex.ts';

export const transport = platformTransport();
export const api = new YandexMusic(transport);

// Yandex-provided names (stations, wave contexts, genres) follow the interface language.
api.language = useLang.getState().lang;
useLang.subscribe((s) => {
  api.language = s.lang;
});

/** localStorage wrapped so a broken/unavailable storage never crashes the app. */
export const storage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // Full (the iPhone's page has about 5 MB): what is only a cache makes room, and it is tried
      // again. It went by silently, and a night of plays was never kept on the phone (the user, 25.10.2026).
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
};

/** Kept only to be quick: made again when gone. */
const CACHES = ['recs.v1'];

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
