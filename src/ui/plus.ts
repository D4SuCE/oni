// Yandex Plus seen in Oni (the user, 30.10.2026: Plus ended and nothing in Oni said so; renewing
// meant going to Yandex to look for it). Settings → Account shows it with its end, a button opens
// Yandex's own Plus page in the browser, signed in there: Oni takes no payments (only Yandex sells
// Plus; a card typed into Yandex's page inside another app's window is how a fake looks), and the
// iPhone may not sell a subscription past Apple. Told once at start when it is gone or about to end.

import type { Account } from '../api/types.ts';

export const PLUS_URL = 'https://plus.yandex.ru/';
/** Told this long before an end that does not renew by itself. */
const AHEAD = 3 * 24 * 60 * 60 * 1000;

/** Yandex's Plus page in the browser (the iPhone hands it to Safari). */
export function openPlus() {
  if (document.documentElement.classList.contains('ios')) location.href = PLUS_URL; // html.ios: main.tsx
  else window.open(PLUS_URL, '_blank');
}

/**
 * What to tell at start, and what to keep as told (`told`: kept last time): "gone" once while there
 * is no Plus, "ending" once per end date; with Plus far from its end nothing, and the next loss is
 * told again.
 */
export function plusNotice(a: Account, told: string, now: number): { tell: 'gone' | 'ending' | null; told: string } {
  if (!a.hasPlus) return { tell: told === 'gone' ? null : 'gone', told: 'gone' };
  if (a.plusUntil && !a.plusRenews && a.plusUntil - now < AHEAD) {
    const key = `ending:${a.plusUntil}`;
    return { tell: told === key ? null : 'ending', told: key };
  }
  return { tell: null, told: '' };
}
