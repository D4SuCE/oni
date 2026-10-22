// Smoke run for the iOS simulator in CI (.github/workflows/ios.yml). The Debug build signs in
// with the runner's token and sets window.__oniTest; this script then walks the main path and
// prints "SMOKE <step> ok|FAIL" lines, which the workflow reads from the console. Nothing is
// sent to the account: test mode keeps wave feedback and listening reports off.

import { OniLogin } from './api/capacitor.ts';
import type { Track } from './api/types.ts';
import { transport } from './api/client.ts';
import { OniRemote } from './player/remote.ts';
import { OniPlayer } from './player/nativeAudio.ts';
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
    if (await what()) return true;
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
  // A sheet along the bottom, all of it on screen (it ran off the bottom on Now Playing).
  const sheet = document.querySelector('.menu')?.getBoundingClientRect();
  const fits = Boolean(sheet && sheet.left >= 0 && sheet.right <= window.innerWidth && sheet.top >= 0 && sheet.bottom <= window.innerHeight);
  row.dispatchEvent(new PointerEvent('pointerup', at));
  row.dispatchEvent(new MouseEvent('mousedown', { ...at, bubbles: true }));
  row.dispatchEvent(new MouseEvent('click', { ...at, bubbles: true }));
  await sleep(300);
  const stays = Boolean(document.querySelector('.menu'));
  report('long-press-menu', Boolean(opened) && stays && fits, `${document.querySelectorAll('.menu-item').length} items${stays ? '' : ', closed on lift'}${fits ? '' : ', off screen'}`);
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

/** The native player (nativeAudio.ts): it plays, and its system equalizer takes the settings. */
async function nativePlayer() {
  const before = await OniPlayer.state();
  await OniPlayer.setEq({ enabled: true, preamp: -3, gains: [6, 4, 2, 0, 0, 0, 0, 2, 3, 3] });
  const on = await OniPlayer.state();
  await OniPlayer.setEq({ enabled: false, preamp: 0, gains: [] });
  report('native-player', before.playing && before.time > 1 && on.eq, JSON.stringify({ ...before, eq: on.eq }));
  // A pause stops the audio engine too, so iOS sees nothing playing (the lock screen showed
  // "pause" still); play runs it again from the same place.
  wave().audio.pause();
  await sleep(700);
  const paused = await OniPlayer.state();
  await wave().audio.play();
  await sleep(1200);
  const resumed = await OniPlayer.state();
  report('pause-stops-engine', !paused.playing && paused.engine === false && resumed.playing && resumed.engine === true && resumed.time >= paused.time, JSON.stringify({ paused, resumed }));
}

/** Does the page keep running while the app is in the background with the native player on? The
 * workflow sends the app away for 25 s and back; a tick every 2 s shows whether this page ran. */
function backgroundProbe() {
  let hiddenAt = 0;
  let timeAt = 0;
  let indexAt = 0;
  let ticks = 0;
  setInterval(() => document.hidden && ticks++, 2000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      timeAt = wave().audio.currentTime;
      indexAt = wave().usePlayer.getState().index;
      ticks = 0;
      return;
    }
    const away = (Date.now() - hiddenAt) / 1000;
    const played = wave().audio.currentTime - timeAt;
    // A short track may end while away: the next one playing is the music going on too.
    const next = wave().usePlayer.getState().index > indexAt;
    console.log(`SMOKE background-life ${played > away / 2 || next ? 'ok' : 'FAIL'} away ${away.toFixed(0)} s, music moved ${played.toFixed(0)} s${next ? ' (on to the next track)' : ''}, page ticks ${ticks}`);
  });
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

/** A list downloads through iOS's background session (iosDownloads.ts): the native side seals the
 * file with the library's key (nothing left unencrypted in oni-incoming), the page moves it into
 * the library, the books are clear, it plays, and the count went to a Live Activity. One track,
 * removed afterwards. */
async function backgroundDownload() {
  // A chart track not downloaded yet (the queue holds one track by now).
  const chart = await (wave() as unknown as { api: { chart(): Promise<Track[]> } }).api.chart().catch(() => [] as Track[]);
  const track = chart.find((t) => t.available !== false && !wave().offline!.has(String(t.id)));
  const bg = background;
  if (!bg || !track) return report('background-download', false, bg ? 'no track to try' : 'no background');
  const started = Date.now();
  const { OniDownloads, useTrackProgress } = await import('./player/iosDownloads.ts');
  let ring = 0;
  const unwatch = useTrackProgress.subscribe((s) => (ring = Math.max(ring, s[String(track.id)] ?? 0)));
  await bg.add('smoke', [track], 'Smoke');
  const live = await until(async () => (await OniDownloads.state()).total > 0, 5000);
  const state = await OniDownloads.state();
  const kept = await until(() => wave().offline!.has(String(track.id)) && !bg.pendingFor('smoke'), 90000);
  unwatch();
  const { Directory, Filesystem } = await import('@capacitor/filesystem');
  const plain = (await Filesystem.readdir({ path: 'oni-incoming', directory: Directory.Library }).catch(() => ({ files: [] }))).files.length;
  report('background-download', kept && !plain, `${((Date.now() - started) / 1000).toFixed(1)} s, pending ${bg.pendingFor('smoke')}, unencrypted left ${plain}, ring up to ${ring.toFixed(2)}`);
  // The Dynamic Island / lock screen: a Live Activity, where the simulator allows them.
  report('live-activity', Boolean(live) && state.total === 1, JSON.stringify(state));
  // Its row shows it downloaded, left of "…" (the cell with the arrow was hidden on the phone).
  click('[data-testid="nav-home"]');
  const mark = await until(() => {
    const m = document.querySelector(`.track-row[data-track-id="${track.id}"] [data-testid="saved-mark"]`);
    return m && m.getBoundingClientRect().width > 0 && m.checkVisibility();
  }, 10000);
  report('row-saved-mark', Boolean(mark), document.querySelector(`.track-row[data-track-id="${track.id}"]`) ? 'row there' : 'no row for it on Home');
  // Cancelled: the island and the lock screen let go of the count (they kept the old numbers).
  const more = chart.filter((t) => t.available !== false && !wave().offline!.has(String(t.id)) && String(t.id) !== String(track.id)).slice(0, 2);
  await bg.add('smoke-cancel', more, 'Cancel');
  await until(async () => (await OniDownloads.state()).activity, 5000);
  await bg.cancel('smoke-cancel');
  const gone = await until(async () => !(await OniDownloads.state()).activity, 5000);
  report('live-activity-cancel', Boolean(gone) && more.length === 2, JSON.stringify(await OniDownloads.state()));
  await wave().playTracks([track], 0, 'smoke');
  const played = await until(() => wave().audio.src.startsWith('oni-sealed:') && !wave().audio.paused && wave().audio.currentTime > 1, 20000);
  report('native-sealed-playback', played, wave().audio.src.slice(0, 12));
  await (wave().offline as unknown as { remove(id: string): Promise<void> }).remove(String(track.id));
}

/** An own playlist on the phone: its buttons fit the screen, and "…" holds rename and delete. */
async function playlistActions() {
  const app = (window as unknown as { __wave: { useApp: { getState(): { playlists: { uid: number; kind: number; owner?: { uid: number } }[]; account: { uid: number } | null } }; navigate(r: unknown): void } }).__wave;
  const { playlists, account } = app.useApp.getState();
  const own = playlists.find((p) => String(p.uid) === String(account?.uid));
  if (!own) return report('playlist-actions', false, 'no own playlist');
  app.navigate({ name: 'playlist', uid: own.uid, kind: own.kind });
  await until(() => document.querySelector('[data-testid="playlist-more"]'), 15000);
  const over = [...document.querySelectorAll<HTMLElement>('.page-actions > *')].filter((b) => b.getBoundingClientRect().right > window.innerWidth + 1).length;
  click('[data-testid="playlist-more"]');
  await until(() => document.querySelector('.menu'), 3000);
  const items = [...document.querySelectorAll('.menu .menu-item')].map((i) => i.textContent?.trim());
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  // Search right after the other buttons, "…" at the right edge (the user's wish).
  const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
  const search = box('[data-testid="list-search"]');
  const more = box('[data-testid="playlist-more"]');
  // At the page's edge, with a gap after the other buttons (not just the last of the row).
  const edge = document.querySelector('.page-header')!.getBoundingClientRect().right;
  const placed = Boolean(search && more && Math.abs(more.right - edge) <= 2 && search.right <= more.left);
  const where = `search ${search?.left.toFixed(0)}–${search?.right.toFixed(0)}, "…" ${more?.left.toFixed(0)}–${more?.right.toFixed(0)}, edge ${edge.toFixed(0)}`;
  report('playlist-actions', over === 0 && placed && items.some((i) => /удалить|delete/i.test(i ?? '')), `${over} off screen; ${where}; menu: ${items.join(', ')}`);
}

/** On a page opened from somewhere (the own playlist above), a pull down from its top goes back
 * (src/ui/swipe.ts, useSwipeBack); a page scrolled down only scrolls. Then Liked's "…" has Radio. */
async function swipeBack() {
  const app = (window as unknown as { __wave: { useApp: { getState(): { route: { name: string } } } } }).__wave;
  const main = document.querySelector<HTMLElement>('.main')!;
  main.scrollTop = 0;
  const pull = (target: Element, ys: number[]) => {
    const touch = (y: number) => new Touch({ identifier: 3, target, clientX: 180, clientY: y });
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(ys[0])], changedTouches: [touch(ys[0])], bubbles: true, cancelable: true }));
    for (const y of ys.slice(1)) target.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(y)], changedTouches: [touch(y)], bubbles: true, cancelable: true }));
    const last = ys[ys.length - 1];
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(last)], bubbles: true, cancelable: true }));
  };
  const from = document.querySelector('.page-header') ?? main;
  pull(from, [260, 300, 360, 440, 520]);
  const left = await until(() => app.useApp.getState().route.name !== 'playlist', 3000);
  report('swipe-back', left, `route ${app.useApp.getState().route.name}`);
  click('[data-testid="nav-liked"]');
  await until(() => document.querySelector('[data-testid="liked-more"]'), 20000);
  click('[data-testid="liked-more"]');
  await until(() => document.querySelector('.menu'), 3000);
  const items = [...document.querySelectorAll('.menu .menu-item')].map((i) => i.textContent?.trim());
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  report('liked-radio', items.some((i) => /радио|radio/i.test(i ?? '')), items.join(', '));
}

/** The phone's top: the offline banner sits below the status bar and the Dynamic Island (it was
 * under them), and the "For you" cards have no unseen Play button (a tap there played the list). */
async function phoneTop() {
  const app = (window as unknown as { __wave: { useApp: { getState(): { offline: boolean }; setState(s: { offline: boolean }): void } } }).__wave.useApp;
  const probe = Object.assign(document.createElement('div'), { style: 'position:fixed;top:0;height:env(safe-area-inset-top)' });
  document.body.append(probe);
  const safeTop = probe.getBoundingClientRect().height;
  probe.remove();
  click('[data-testid="nav-home"]');
  await until(() => document.querySelector('[data-testid="mix-card"]'), 15000);
  const play = document.querySelector('[data-testid="mix-card"] .card-play');
  const unseen = play ? getComputedStyle(play).display !== 'none' : false;
  const was = app.getState().offline;
  app.setState({ offline: true });
  const banner = await until(() => document.querySelector('[data-testid="offline-banner"]'), 3000);
  const top = document.querySelector('[data-testid="offline-banner"]')?.getBoundingClientRect().top ?? -1;
  app.setState({ offline: was });
  report('phone-top', Boolean(banner) && top >= safeTop && !unseen, `banner at ${top}, status bar ${safeTop}; card play button ${unseen ? 'there' : 'gone'}`);
  // No endless motion under the glass (heat): the backdrop and the banner's glow stand still.
  const endless = document.getAnimations().filter((a) => {
    const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
    return a.playState === 'running' && a.effect?.getTiming().iterations === Infinity && target?.closest('.backdrop-img, .wave-blobs');
  });
  report('no-endless-backdrop', !endless.length, `${endless.length} running`);
}

/** The update check reads the SideStore source (iosUpdate.ts): latest, or a newer one offered. */
async function updateCheck() {
  const { checkIosUpdate } = await import('./ui/iosUpdate.ts');
  const { useUpdate } = await import('./ui/update.ts');
  await checkIosUpdate();
  const u = useUpdate.getState();
  report('update-check', u.status === 'latest' || (u.status === 'ready' && Boolean(u.url)), `${u.status} ${u.version ?? ''} ${u.error ?? ''}`);
  // As an old version would: the newest one is offered, with a message that goes away by itself,
  // and "Update" opens SideStore with its IPA (installing is SideStore's, with the Apple ID).
  const { updateLink, useAutoUpdate } = await import('./ui/iosUpdate.ts');
  useAutoUpdate.setState({ on: false, shortcut: false });
  useUpdate.setState({ status: 'off', version: undefined, url: undefined }, true);
  await checkIosUpdate('0.0.1');
  const old = useUpdate.getState();
  const shown = await until(() => document.querySelector('.toast')?.textContent?.includes(old.version ?? '?'), 3000);
  const gone = shown && (await until(() => !document.querySelector('.toast')?.textContent?.includes(old.version ?? '?'), 6000));
  const link = updateLink() ?? '';
  const ipa = decodeURIComponent(link.replace('sidestore://install?url=', ''));
  report('update-offer', old.status === 'ready' && Boolean(shown) && Boolean(gone) && link.startsWith('sidestore://install?url=') && ipa.endsWith('.ipa') && ipa === old.url, `${old.status} ${old.version}; toast ${shown ? 'shown' : 'not shown'}${gone ? ', gone' : ''}; ${link}`);
  await checkIosUpdate();
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
    // The phone's player fetches a track whole before it plays: a slow CDN on the runner takes time.
    const playing = await until(() => !wave().audio.paused && wave().audio.currentTime > 2, 60000);
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
    // Opened by the native player from the sealed file (no audio through the page).
    const local = await until(() => wave().audio.src.startsWith('oni-sealed:') && !wave().audio.paused && wave().audio.currentTime > 1, 20000);
    report('offline-playback', local, wave().audio.src.slice(0, 12));
    await nativePlayer();
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
    await sleep(1100); // past the hold's aftermath (src/ui/longPress.ts); a real tap would start a new touch
    await tapToPlay();
    await uploadForm();
    await playlistActions();
    await swipeBack();
    await phoneTop();
    await updateCheck();
  } catch (e) {
    report('crash', false, String(e));
  }
  backgroundProbe();
  console.log('SMOKE done');
}
