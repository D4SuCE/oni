// Pictures of the iPhone's main screens for the releases page (.github/workflows/screens.yml).
// The Debug build signs in with the runner's token and sets window.__oniScreens; this walks the
// screens and leaves each as Documents/shot-<name>.png (OniPlayer.snapshot: Oni's window, exact).
// A picture taken from outside (simctl, with the status bar) came late and at random on the cloud
// Mac — another screen's under the name — so the status bar and the Dynamic Island are laid over
// later (scripts/readme-art.mjs, design/iphone-statusbar.png). Nothing is sent to the account.

import { OniPlayer } from './player/nativeAudio.ts';
import { next } from './player/player.ts';

type Wave = {
  audio: HTMLAudioElement;
  usePlayer: { getState(): { queue: { id: string; title: string }[]; index: number } };
  useApp: { setState(s: object): void };
  navigate(route: object): void;
};

const wave = () => (window as unknown as { __wave: Wave }).__wave;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: () => unknown, timeout: number) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await what()) return true;
    await sleep(250);
  }
  return false;
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector);

/** The screen as it is now. */
async function screen(name: string) {
  await sleep(1800);
  // no account name in the greeting
  const greeting = $('.greeting');
  if (greeting) greeting.textContent = greeting.textContent!.split(',')[0];
  await OniPlayer.snapshot({ name }).catch((e) => console.log(`SCREENS ${name} failed: ${e}`));
  console.log(`SCREENS ${name}`);
}

/** Back to a page with nothing open over it. */
function closeAll() {
  wave().useApp.setState({ nowPlayingOpen: false, soundOpen: false });
}

async function go(route: object, ready: string, timeout = 30000) {
  closeAll();
  wave().navigate(route);
  await until(() => $(ready), timeout);
  document.querySelector('.main')?.scrollTo(0, 0);
}

export async function runScreens() {
  try {
    await until(() => $('.wave-hero'), 60000);
    // My Wave playing: the bar at the bottom shows a track, Play shows Pause
    await until(() => document.querySelectorAll('[data-testid="mix-card"]').length > 3, 60000);
    $('[data-testid="wave-play"]')?.click();
    await until(() => !wave().audio.paused && wave().audio.currentTime > 1, 60000);
    // a track with words in time, for the lyrics (a few along the wave; "Text unavailable" on some)
    wave().useApp.setState({ nowPlayingOpen: true });
    await until(() => $('[data-testid="np-lyrics"]'), 10000);
    for (let i = 0; i < 10; i++) {
      await sleep(1500);
      $('[data-testid="np-lyrics"]')?.click();
      if (await until(() => $('[data-testid="np-sung"] .lyric'), 12000)) break;
      $('[data-testid="np-lyrics"]')?.click();
      void next(true);
      await until(() => !wave().audio.paused && wave().audio.currentTime > 1, 30000);
    }
    // the lyrics now, while they are there; the cover after
    await sleep(3000);
    await screen('lyrics');
    $('[data-testid="np-lyrics"]')?.click();
    await sleep(1000);
    await screen('now-playing');
    closeAll();
    // Home: My Wave and the shelves under it, all filled in
    await until(() => !document.body.innerText.includes('Собираю'), 60000);
    await sleep(2500);
    await screen('home');


    // A mix from "For you" (the first card: the daylist)
    await go({ name: 'home' }, '[data-testid="mix-card"]');
    $('[data-testid="mix-card"]')?.click();
    await until(() => document.querySelectorAll('.track-row').length > 5, 30000);
    await screen('mix');

    await go({ name: 'library', tab: 'playlists' }, '.card, .track-row');
    await sleep(2000);
    await screen('collection');

    await go({ name: 'search' }, '[data-testid="search-input"]');
    const input = $<HTMLInputElement>('[data-testid="search-input"]');
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Kenshi Yonezu');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      await until(() => document.querySelectorAll('.track-row').length > 2, 20000);
    }
    await screen('search');

    // what the account played, all devices (this new phone has played one track)
    await go({ name: 'history' }, '[data-testid="history-yandex"]');
    $('[data-testid="history-yandex"]')?.click();
    await until(() => document.querySelectorAll('.history-group .track-row').length > 3, 30000);
    await screen('history');

    // Sound: the equalizer on, the "Bass" preset (over the mix's page)
    await go({ name: 'home' }, '.wave-hero');
    wave().useApp.setState({ soundOpen: true });
    await until(() => $('[data-testid="sound-panel"]'), 5000);
    const eq = $<HTMLInputElement>('[data-testid="eq-toggle"]');
    if (eq && !eq.checked) eq.click();
    $('[data-testid="eq-preset"]')?.click();
    await until(() => $('[data-testid="preset-bass"]'), 3000);
    $('[data-testid="preset-bass"]')?.click();
    await screen('sound');
    closeAll();
  } catch (e) {
    console.log(`SCREENS crashed ${e}`);
  }
  console.log('SCREENS done');
}
