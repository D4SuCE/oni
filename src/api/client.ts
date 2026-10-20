import { platformTransport } from './transport.ts';
import { YandexMusic } from './yandex.ts';

export const transport = platformTransport();
export const api = new YandexMusic(transport);

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
    } catch {
      /* ignore */
    }
  },
};

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
