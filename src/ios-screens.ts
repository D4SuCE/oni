// Pictures of the iPhone's main screens for the releases page (.github/workflows/screens.yml).
// The Debug build signs in with the runner's token and sets window.__oniScreens; this walks the
// screens, and on each one leaves Documents/shot-<name>.png (OniPlayer.snapshot) — the runner sees
// the file come and takes the whole screen from outside (status bar and Dynamic Island with it),
// while this holds still. "SCREENS done" ends it. Nothing is sent to the account (test mode).

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

/** The screen as it is: the runner takes it from outside once the file comes, this holds still. */
async function screen(name: string) {
  await sleep(1800);
  await OniPlayer.snapshot({ name }).catch((e) => console.log(`SCREENS ${name} failed: ${e}`));
  console.log(`SCREENS ${name}`);
  await sleep(5000);
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
    // a track with words, for the lyrics (a few tries along the wave)
    for (let i = 0; i < 6; i++) {
      wave().useApp.setState({ nowPlayingOpen: true });
      const button = await until(() => $('[data-testid="np-lyrics"]'), 10000);
      await sleep(1500);
      if (button && !$('[data-testid="np-lyrics"]')!.classList.contains('dim')) break;
      void next(true);
      await until(() => !wave().audio.paused && wave().audio.currentTime > 1, 30000);
    }
    closeAll();
    // Home: My Wave and the shelves under it, all filled in
    await until(() => !document.body.innerText.includes('Собираю'), 60000);
    await sleep(2500);
    await screen('home');

    wave().useApp.setState({ nowPlayingOpen: true });
    await until(() => $('.nowplaying'), 5000);
    await screen('now-playing');

    $('[data-testid="np-lyrics"]')?.click();
    await until(() => $('[data-testid="np-sung"] .lyric, [data-testid="np-sung"] .lyrics-plain'), 20000);
    await sleep(3000);
    await screen('lyrics');
    $('[data-testid="np-lyrics"]')?.click();

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

    await go({ name: 'history' }, '.track-row');
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
