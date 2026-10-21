// Smoke run for the iOS simulator in CI (.github/workflows/ios.yml). The Debug build signs in
// with the runner's token and sets window.__oniTest; this script then walks the main path and
// prints "SMOKE <step> ok|FAIL" lines, which the workflow reads from the console. Nothing is
// sent to the account: test mode keeps wave feedback and listening reports off.

import { OniLogin } from './api/capacitor.ts';
import { transport } from './api/client.ts';
import { OniRemote } from './player/remote.ts';
import { OniVolume } from './player/volume.ts';
import { background } from './ui/offline.ts';

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

/** The phone's taps: one tap on a track plays it, and its artists are text, not links. */
async function tapToPlay() {
  const rows = document.querySelectorAll<HTMLElement>('.track-row');
  const row = rows[1] ?? rows[0];
  const links = document.querySelectorAll('.track-row .tr-artists a').length;
  const id = row?.dataset.trackId;
  row?.querySelector<HTMLElement>('.tr-title')?.click();
  const played = await until(() => {
    const { queue, index } = wave().usePlayer.getState();
    return String((queue[index] as { id?: unknown } | undefined)?.id) === id;
  }, 8000);
  report('tap-to-play', Boolean(id) && played && links === 0, `${links} artist links`);
}

/** Four tabs below, search and settings as icons on Home. */
function phoneLayout() {
  const tabs = [...document.querySelectorAll<HTMLElement>('.sidebar .nav-item')].filter((b) => b.offsetParent);
  const order = tabs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((b) => b.dataset.testid?.replace('nav-', ''));
  const icons = ['top-search', 'top-settings'].filter((t) => document.querySelector(`[data-testid="${t}"]`)).length;
  const want = 'home library history liked';
  report('phone-layout', order.join(' ') === want && icons === 2, `${order.join(' ')}, ${icons} top icons`);
}

/** Uploading your own mp3 from the phone: the native side must build a multipart body with the
 * file intact. A public echo service stands in for Yandex, so nothing lands in the account. */
async function uploadForm() {
  const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0xff, 0x80, 0x0d, 0x0a, 0x2d]);
  const part = { field: 'file', filename: 'смоук.mp3', contentType: 'audio/mpeg', data: bytes.buffer };
  for (const url of ['https://httpbin.org/post', 'https://postman-echo.com/post']) {
    try {
      const r = await transport.request<{ files?: Record<string, string> }>({ method: 'POST', url, multipart: part });
      const got = r.data?.files?.file ?? '';
      // Echo services return a binary file as a data URL or as text; compare the bytes either way.
      const back = got.startsWith('data:') ? Uint8Array.from(atob(got.split(',')[1]), (c) => c.charCodeAt(0)) : Uint8Array.from(got, (c) => c.charCodeAt(0));
      const same = back.length === bytes.length && back.every((b, i) => b === bytes[i]);
      return report('upload-form', r.ok && same, `${new URL(url).host}: ${r.status}, ${back.length} bytes back`);
    } catch (e) {
      console.log(`upload-form: ${url} unavailable (${e})`);
    }
  }
  report('upload-form', false, 'no echo service answered');
}

/** Equalizer and volume on the iPhone (src/player/processing.ts) rest on this: Web Audio hears a
 * track fetched whole through the native HTTP stack and played from memory. A separate element
 * and context, muted at the end, so the main player is untouched. */
async function webAudioFromMemory() {
  const { queue, index } = wave().usePlayer.getState();
  const track = queue[index] as unknown as { id: string };
  wave().audio.pause();
  try {
    const stream = await (wave() as unknown as { api: { stream(id: string): Promise<{ url: string }> } }).api.stream(track.id);
    const bytes = await transport.fetchBytes!(stream.url);
    const el = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaElementSource(el).connect(analyser).connect(mute).connect(ctx.destination);
    await ctx.resume();
    await el.play();
    await sleep(2500);
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
    el.pause();
    await ctx.close();
    report('web-audio-memory', rms > 0.001, `rms ${rms.toFixed(4)}, ${(bytes.byteLength / 1e6).toFixed(1)} MB`);
  } catch (e) {
    report('web-audio-memory', false, String(e));
  }
  await wave().audio.play().catch(() => {});
}

/** Now Playing's seek bar: a tap in its middle (not on the thumb) takes the track there, once,
 * when the finger lifts (src/ui/touchRange.ts, SeekBar). */
async function touchSeek() {
  const bar = document.querySelector<HTMLInputElement>('.nowplaying .np-seek input[type=range]');
  if (!bar) return report('touch-seek', false, 'no seek bar');
  const box = bar.getBoundingClientRect();
  const at = { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true };
  bar.dispatchEvent(new PointerEvent('pointerdown', at));
  bar.dispatchEvent(new PointerEvent('pointerup', at));
  const half = wave().audio.duration / 2;
  const moved = await until(() => Math.abs(wave().audio.currentTime - half) < 5, 5000);
  report('touch-seek', moved, `at ${wave().audio.currentTime.toFixed(1)} of ${wave().audio.duration.toFixed(1)}`);
}

/** A list downloads through iOS's background session (iosDownloads.ts): the file lands in the
 * folder, is sealed into the library, and the books are clear. One track, removed afterwards. */
async function backgroundDownload() {
  const { queue, index } = wave().usePlayer.getState();
  const track = (queue as unknown as { id: string }[]).slice(index + 1).find((t) => !wave().offline!.has(t.id));
  if (!background || !track) return report('background-download', false, background ? 'no track to try' : 'no background');
  const started = Date.now();
  await background.add('smoke', [track]);
  const kept = await until(() => wave().offline!.has(track.id) && !background.pendingFor('smoke'), 90000);
  report('background-download', kept, `${((Date.now() - started) / 1000).toFixed(1)} s, pending ${background.pendingFor('smoke')}`);
  await (wave().offline as unknown as { remove(id: string): Promise<void> }).remove(track.id);
}

export async function runSmoke() {
  try {
    noZoom();
    await loginRedirect();
    report('home', await until(() => document.querySelector('.wave-hero'), 30000));
    phoneLayout();
    const mixes = await until(() => document.querySelectorAll('[data-testid="mix-card"]').length, 60000);
    report('mixes', mixes, String(document.querySelectorAll('[data-testid="mix-card"]').length));

    click('[data-testid="wave-play"]');
    const playing = await until(() => !wave().audio.paused && wave().audio.currentTime > 2, 30000);
    const { queue, index } = wave().usePlayer.getState();
    const title = queue[index]?.title ?? '';
    report('playback', playing, `"${title}" at ${wave().audio.currentTime.toFixed(1)} s`);
    // No CORS request for the stream here: the CDN would refuse it and nothing would play.
    report('no-cors-audio', wave().audio.crossOrigin === null);
    // The lock screen title adds the version ("Title (Slowed)"), see updateMediaSession.
    report('media-session', navigator.mediaSession?.metadata?.title?.startsWith(title) === true, `"${navigator.mediaSession?.metadata?.title ?? ''}"`);
    // The lock screen: told what plays, with previous / next / like and no ±10 s (OniRemote).
    const remote = await OniRemote.state();
    report('lock-screen', remote.title.startsWith(title) && remote.next && remote.prev && remote.like && !remote.skip, JSON.stringify(remote));

    click('.pb-cover');
    report('now-playing', await until(() => document.querySelector('.nowplaying'), 5000));
    await sleep(2500);
    await touchSeek();
    const { value } = await OniVolume.get().catch(() => ({ value: -1 }));
    report('phone-volume', value >= 0 && value <= 1, `system volume ${value}`);
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
    await webAudioFromMemory();
    await backgroundDownload();

    // A shortcut's link. The page asks iOS to open it (Capacitor hands non-web addresses to the
    // system), so it comes back through the scene as from a shortcut, without the "Open in Oni?"
    // prompt that `simctl openurl` raises and nobody can tap in CI.
    location.href = 'oni://search?text=%D0%9A%D0%B8%D0%BD%D0%BE+%D0%93%D1%80%D1%83%D0%BF%D0%BF%D0%B0+%D0%BA%D1%80%D0%BE%D0%B2%D0%B8';
    const searched = await until(() => document.querySelector('[data-testid="search-input"]') && document.querySelectorAll('.track-row').length, 45000);
    const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
    const keyboard = document.activeElement === input;
    report('search-link', Boolean(searched) && input?.value === 'Кино Группа крови' && !keyboard, `"${input?.value ?? ''}", ${document.querySelectorAll('.track-row').length} tracks${keyboard ? ', keyboard up' : ''}`);
    await longPressMenu();
    await sleep(600); // a person's next tap, after the hold's aftermath (src/ui/longPress.ts)
    await tapToPlay();
    await uploadForm();
  } catch (e) {
    report('crash', false, String(e));
  }
  console.log('SMOKE done');
}
