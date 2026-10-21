// Smoke run for the iOS simulator in CI (.github/workflows/ios.yml). The Debug build signs in
// with the runner's token and sets window.__oniTest; this script then walks the main path and
// prints "SMOKE <step> ok|FAIL" lines, which the workflow reads from the console. Nothing is
// sent to the account: test mode keeps wave feedback and listening reports off.

import { OniLogin } from './api/capacitor.ts';

type Wave = {
  audio: HTMLAudioElement;
  usePlayer: { getState(): { queue: { id: string; title: string }[]; index: number } };
  offline: { download(t: unknown): Promise<void>; has(id: string): boolean } | null;
  playTracks(tracks: unknown[], index: number, title: string): Promise<void>;
};

const wave = () => (window as unknown as { __wave: Wave }).__wave;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: () => unknown, timeout: number) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (what()) return true;
    await sleep(250);
  }
  return false;
}

const report = (step: string, ok: boolean, detail = '') => console.log(`SMOKE ${step} ${ok ? 'ok' : 'FAIL'}${detail ? ` ${detail}` : ''}`);
const click = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.click();

/** Sign-in: the redirect to music.yandex.ru with the token is caught in the app's sheet (on a phone
 * with Yandex's app installed iOS used to open that app instead). A test page stands in for the
 * Yandex sign-in, so the real token stays as it is. */
async function loginRedirect() {
  const redirect = 'https://music.yandex.ru/#access_token=smoke-token&token_type=bearer';
  const page = `data:text/html,${encodeURIComponent(`<script>setTimeout(()=>location.href=${JSON.stringify(redirect)},500)</script>`)}`;
  const timeout = new Promise<{ token?: string }>((r) => setTimeout(() => r({ token: 'timeout' }), 15000));
  const { token } = await Promise.race([OniLogin.open({ url: page }), timeout]);
  report('login-redirect', token === 'smoke-token', token ?? 'none');
}

/** Fields iPhone would zoom into: text under 16 px (a sample of each kind, the sign-in screen's
 * token field among them), and a viewport that still allows zooming. */
function noZoom() {
  const probes = ['input', 'textarea'].map((tag) => Object.assign(document.createElement(tag), { className: 'input' }));
  document.body.append(...probes);
  const fields = [...probes, ...document.querySelectorAll('input:not([type=range])')] as HTMLElement[];
  const small = fields.map((f) => parseFloat(getComputedStyle(f).fontSize)).filter((px) => px < 16);
  probes.forEach((p) => p.remove());
  const viewport = document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '';
  report('no-zoom', !small.length && /maximum-scale=1(?![\d.])/.test(viewport), `${fields.length} fields, small: ${small.join(',') || 'none'}`);
}

/** Now Playing on a phone: the collapse button below the status bar (taps up there belong to
 * iOS), then a downward swipe from the cover, which must close the screen. */
function nowPlayingCloses() {
  const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;top:0;height:env(safe-area-inset-top)' });
  document.body.append(probe);
  const safeTop = probe.getBoundingClientRect().height;
  probe.remove();
  const button = document.querySelector('.np-close')?.getBoundingClientRect();
  report('np-close-reachable', Boolean(button && safeTop > 0 && button.top >= safeTop), `button at ${button?.top ?? '?'}, status bar ${safeTop}`);
  const from = document.querySelector('.np-cover') ?? document.querySelector('.nowplaying')!;
  const at = (y: number) => ({ pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: y, bubbles: true });
  from.dispatchEvent(new PointerEvent('pointerdown', at(300)));
  for (const y of [340, 420, 520]) window.dispatchEvent(new PointerEvent('pointermove', at(y)));
  window.dispatchEvent(new PointerEvent('pointerup', at(520)));
}

/** A long press on a track opens its menu, and lifting the finger neither closes it nor plays. */
async function longPressMenu() {
  const row = document.querySelector('.track-row');
  if (!row) return report('long-press-menu', false, 'no track row');
  const box = row.getBoundingClientRect();
  const at = { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: box.left + 40, clientY: box.top + box.height / 2, bubbles: true };
  row.dispatchEvent(new PointerEvent('pointerdown', at));
  const opened = await until(() => document.querySelector('.menu'), 1500);
  row.dispatchEvent(new PointerEvent('pointerup', at));
  row.dispatchEvent(new MouseEvent('mousedown', { ...at, bubbles: true }));
  row.dispatchEvent(new MouseEvent('click', { ...at, bubbles: true }));
  await sleep(300);
  const stays = Boolean(document.querySelector('.menu'));
  report('long-press-menu', Boolean(opened) && stays, `${document.querySelectorAll('.menu-item').length} items${stays ? '' : ', closed on lift'}`);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

export async function runSmoke() {
  try {
    noZoom();
    await loginRedirect();
    report('home', await until(() => document.querySelector('.wave-hero'), 30000));
    const mixes = await until(() => document.querySelectorAll('[data-testid="mix-card"]').length, 60000);
    report('mixes', mixes, String(document.querySelectorAll('[data-testid="mix-card"]').length));

    click('[data-testid="wave-play"]');
    const playing = await until(() => !wave().audio.paused && wave().audio.currentTime > 2, 30000);
    const { queue, index } = wave().usePlayer.getState();
    const title = queue[index]?.title ?? '';
    report('playback', playing, `"${title}" at ${wave().audio.currentTime.toFixed(1)} s`);
    // No CORS request for the stream here: the CDN would refuse it and nothing would play.
    report('no-cors-audio', wave().audio.crossOrigin === null);
    report('media-session', navigator.mediaSession?.metadata?.title === title, `"${navigator.mediaSession?.metadata?.title ?? ''}"`);

    click('.pb-cover');
    report('now-playing', await until(() => document.querySelector('.nowplaying'), 5000));
    await sleep(2500);
    nowPlayingCloses();
    report('np-swipe-down', await until(() => !document.querySelector('.nowplaying'), 3000));
    click('.pb-cover');
    await until(() => document.querySelector('.nowplaying'), 5000);

    // Download: the track goes to the app's folder (encrypted) and then plays from there.
    const track = queue[index];
    await wave().offline!.download(track);
    report('download', wave().offline!.has(track.id));
    await wave().playTracks([track], 0, 'smoke');
    const local = await until(() => wave().audio.src.startsWith('blob:') && !wave().audio.paused && wave().audio.currentTime > 1, 20000);
    report('offline-playback', local, wave().audio.src.slice(0, 5));

    // A shortcut's link. The page asks iOS to open it (Capacitor hands non-web addresses to the
    // system), so it comes back through the scene as from a shortcut, without the "Open in Oni?"
    // prompt that `simctl openurl` raises and nobody can tap in CI.
    location.href = 'oni://search?text=%D0%9A%D0%B8%D0%BD%D0%BE+%D0%93%D1%80%D1%83%D0%BF%D0%BF%D0%B0+%D0%BA%D1%80%D0%BE%D0%B2%D0%B8';
    const searched = await until(() => document.querySelector('[data-testid="search-input"]') && document.querySelectorAll('.track-row').length, 45000);
    const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
    const keyboard = document.activeElement === input;
    report('search-link', Boolean(searched) && input?.value === 'Кино Группа крови' && !keyboard, `"${input?.value ?? ''}", ${document.querySelectorAll('.track-row').length} tracks${keyboard ? ', keyboard up' : ''}`);
    await longPressMenu();
  } catch (e) {
    report('crash', false, String(e));
  }
  console.log('SMOKE done');
}
