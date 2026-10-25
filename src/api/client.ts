import { useLang } from '../i18n.ts';
import { storage } from './storage.ts';
import { platformTransport } from './transport.ts';
import { YandexMusic } from './yandex.ts';

export const transport = platformTransport();
export const api = new YandexMusic(transport);

// Yandex-provided names (stations, wave contexts, genres) follow the interface language.
api.language = useLang.getState().lang;
useLang.subscribe((s) => {
  api.language = s.lang;
});

export { storage };

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
