// Smoke run for the iOS simulator in CI (.github/workflows/ios.yml). The Debug build signs in
// with the runner's token and sets window.__oniTest; this script then walks the main path and
// prints "SMOKE <step> ok|FAIL" lines, which the workflow reads from the console. Nothing is
// sent to the account: test mode keeps wave feedback and listening reports off.

import { OniLogin } from './api/capacitor.ts';
import type { Track } from './api/types.ts';
import { storage, transport } from './api/client.ts';
import { OniRemote } from './player/remote.ts';
import { OniPlayer, type EqShape } from './player/nativeAudio.ts';
import { OniVolume } from './player/volume.ts';
import { background } from './ui/offline.ts';
import { EQ_PRESETS, EQ_Q, eqResponse } from './player/eqCurve.ts';
import { registerPlugin } from '@capacitor/core';

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

/** Report lines held while a step may still get its second try (twice). */
let held: string[] | null = null;
const report = (step: string, ok: boolean, detail = '') => {
  const line = `SMOKE ${step} ${ok ? 'ok' : 'FAIL'}${detail ? ` ${detail}` : ''}`;
  if (held) held.push(line);
  else console.log(line);
};

/** Steps that hang on the cloud Mac's speed (they passed and failed on the same code; ROADMAP,
 * «Хвосты»): a failure gets one more try. The first try's failures are printed as SMOKE-SLOW (seen in
 * the log, not failing the run); the second try's count. */
async function twice(fn: () => Promise<void>) {
  held = [];
  await fn().catch((e) => held!.push(`SMOKE step-crash FAIL ${e}`));
  const first = held;
  held = null;
  if (!first.some((l) => / FAIL( |$)/.test(l))) return first.forEach((l) => console.log(l));
  first.forEach((l) => console.log(l.replace(/^SMOKE (\S+) FAIL/, 'SMOKE-SLOW $1 first try failed:')));
  await fn();
}
/** A picture of the screen as it is now, taken by the cloud run (ios.yml, "SMOKE-SHOT"). */
async function picture(name: string) {
  console.log(`SMOKE-SHOT ${name}`);
  await sleep(2500);
}

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

/** No magnifier on a double tap (the user): nothing selectable but fields, no callout, no
 * double-tap gesture. Lyrics were selectable (user-select: text), a probe stands for them. */
function noLoupe() {
  const lyric = Object.assign(document.createElement('div'), { className: 'lyric', textContent: 'la' });
  const field = Object.assign(document.createElement('input'), { className: 'input' });
  document.body.append(lyric, field);
  const sample = [lyric, ...document.querySelectorAll('.page-title, .track-row, .card, .nav-item, button')].slice(0, 30) as HTMLElement[];
  const css = (el: Element) => getComputedStyle(el) as CSSStyleDeclaration & { webkitUserSelect: string; webkitTouchCallout?: string };
  const selectable = sample.filter((el) => css(el).webkitUserSelect !== 'none' || (css(el).webkitTouchCallout ?? 'none') !== 'none');
  const fieldOk = css(field).webkitUserSelect !== 'none';
  const touch = getComputedStyle(document.body).touchAction;
  lyric.remove();
  field.remove();
  report('no-loupe', !selectable.length && fieldOk && touch === 'manipulation', `${sample.length} checked, selectable: ${selectable.map((el) => el.className).join(',') || 'none'}, field ${fieldOk ? 'editable' : 'not selectable'}, body ${touch}`);
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

/** Holding an icon-only button shows what it does above it, and lifting the finger does not press
 * it ("Next" stays on the same track). */
/** A round button whose words the iPhone hides (Shuffle on a page's row, as in Liked) names itself
 * when held, by those words (the user, 25.10.2026: "many buttons show nothing, one has to guess").
 * On a chart track's album (Liked may be left in its "Move" mode by the steps before, and what plays
 * may be an upload, whose album is no page). */
async function holdHintRound() {
  const w = wave() as unknown as { navigate(r: unknown): void; api: { chart(): Promise<Track[]> }; useApp?: { getState(): { route: { name: string } } } };
  const chart = await w.api.chart().catch(() => [] as Track[]);
  // The chart's albums, several tracks each: an album may not open from the cloud's Mac (Yandex
  // keeps some to Russia), so up to three are tried (the step failed on a chart day like that).
  const albums = [...new Set(chart.filter((t) => t.available !== false && (t.albums?.[0]?.trackCount ?? 2) > 1).map((t) => t.albums?.[0]?.id).filter(Boolean))].slice(0, 3);
  if (!albums.length) return report('hold-hint-round', false, 'no album to open');
  const shuffle = () => [...document.querySelectorAll<HTMLElement>('.lib-actions .btn:not(.primary), .page-actions .btn:not(.primary)')].find((b) => b.textContent?.includes('Вперемешку'));
  let button: HTMLElement | undefined;
  const tried: string[] = [];
  for (const album of albums) {
    w.navigate({ name: 'album', id: album });
    if (await until(shuffle, 15000)) {
      button = shuffle();
      break;
    }
    const seen = [...document.querySelectorAll<HTMLElement>('.page-actions .btn, .lib-actions .btn')].map((b) => b.textContent?.trim()).join(' | ');
    tried.push(`${album}: route ${w.useApp?.getState().route.name}, buttons [${seen}]`);
  }
  if (!button) return report('hold-hint-round', false, `no Shuffle on the albums: ${tried.join('; ')}`);
  const box = button.getBoundingClientRect();
  const at = { pointerId: 12, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true };
  button.dispatchEvent(new PointerEvent('pointerdown', at));
  await until(() => document.querySelector('.hold-hint'), 1500);
  const text = document.querySelector('.hold-hint')?.textContent ?? '';
  button.dispatchEvent(new PointerEvent('pointerup', at));
  await until(() => !document.querySelector('.hold-hint'), 3000);
  report('hold-hint-round', text === 'Вперемешку' && Math.round(box.width) === 42, `"${text}", the button ${Math.round(box.width)} px wide`);
}

async function holdHint() {
  const shown = (b: HTMLElement) => b.offsetParent && b.getBoundingClientRect().width > 0;
  const next = document.querySelector<HTMLElement>('[data-testid="next"]');
  const button = next && shown(next) ? next : [...document.querySelectorAll<HTMLElement>('button[title]')].find((b) => shown(b) && !b.textContent?.trim());
  if (!button) return report('hold-hint', false, 'no icon button on screen');
  const before = wave().usePlayer.getState().index;
  const box = button.getBoundingClientRect();
  const at = { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true };
  button.dispatchEvent(new PointerEvent('pointerdown', at));
  await until(() => document.querySelector('.hold-hint'), 1500);
  const hint = document.querySelector<HTMLElement>('.hold-hint');
  const text = hint?.textContent ?? '';
  const above = Boolean(hint && hint.getBoundingClientRect().bottom <= box.top + 1);
  button.dispatchEvent(new PointerEvent('pointerup', at));
  button.dispatchEvent(new MouseEvent('click', { ...at, bubbles: true }));
  await sleep(400);
  const pressed = wave().usePlayer.getState().index !== before;
  const gone = Boolean(await until(() => !document.querySelector('.hold-hint'), 3000));
  report('hold-hint', text === button.getAttribute('title') && !pressed && gone, `"${text}" for "${button.getAttribute('title')}"${above ? ' above' : ' below'}${pressed ? ', pressed anyway' : ''}${gone ? '' : ', stayed'}`);
}

/** Every icon-only button on screen has a name VoiceOver reads (its title or aria-label). */
function buttonNames(where: string) {
  const unnamed = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(
    (b) => b.offsetParent && !b.textContent?.trim() && !b.getAttribute('aria-label')?.trim() && !b.getAttribute('title')?.trim(),
  );
  report(`button-names-${where}`, !unnamed.length, unnamed.map((b) => b.className || b.dataset.testid || b.tagName).slice(0, 8).join(', ') || 'all named');
}

/** Text asked for comes as text, also when it is sent as JSON (a file from Yandex Disk is): the
 * native side parsed it into an object, and the shared history skipped the PC's file. */
async function textResponse() {
  const { transport } = await import('./api/client.ts');
  const r = await transport.request<string>({ url: 'https://httpbin.org/json', responseType: 'text' }).catch((e) => ({ ok: false, status: 0, data: String(e) }));
  const text = typeof r.data === 'string';
  let parsed = false;
  try {
    parsed = text && typeof JSON.parse(r.data) === 'object';
  } catch {
    /* not JSON */
  }
  report('text-response', r.ok && text && parsed, `HTTP ${r.status}, ${typeof r.data}`);
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
  // The lock screen's play and pause are the player's own: with the page frozen (paused a few
  // minutes, the screen locked) a play sent to it went nowhere (the user on 1.6.1). Right after
  // the press, before the page could act, the player plays (and then stops).
  wave().audio.pause();
  await sleep(700);
  const pressed = await OniRemote.press({ name: 'play' });
  await sleep(1200);
  const followed = !wave().audio.paused;
  const stopped = await OniRemote.press({ name: 'toggle' });
  await sleep(1200);
  report('lock-screen-play', pressed.playing && followed && !stopped.playing && wave().audio.paused, JSON.stringify({ pressed, page: followed, toggled: stopped }));
  await wave().audio.play();
}

/** Kept awake after a pause (another device may play this one as a remote, sync/elsewhere.ts): the
 * engine runs on silent for the time set, then stops; the lock screen's "pause" meanwhile plays. */
async function awakeAfterPause() {
  await OniPlayer.setAwake({ seconds: 3 });
  wave().audio.pause();
  await sleep(700);
  const kept = await OniPlayer.state();
  const pressed = await OniRemote.press({ name: 'pause' });
  await sleep(500);
  wave().audio.pause();
  await sleep(4000);
  const slept = await OniPlayer.state();
  await OniPlayer.setAwake({ seconds: 0 });
  report('awake-after-pause', !kept.playing && kept.engine === true && pressed.playing && slept.engine === false, JSON.stringify({ kept, pressed, slept }));
  await wave().audio.play();
}

/** The link to the PC on the home network (sync/lan.ts, OniLan): the workflow runs a stand-in PC
 * on the Mac (tests/lan-echo.mjs, the simulator shares its network); a hello with the key is
 * welcomed, a message comes back, and how long that took. */
async function lanLink() {
  const lan = registerPlugin<{
    open(o: { id: string; url: string; hello: string; timeout?: number }): Promise<void>;
    send(o: { id: string; text: string }): Promise<void>;
    close(o: { id: string }): Promise<void>;
    addListener(e: 'message', cb: (m: { id: string; text: string }) => void): Promise<{ remove(): Promise<void> }>;
  }>('OniLan');
  const got: string[] = [];
  const listener = await lan.addListener('message', (m) => got.push(m.text));
  try {
    const refused = await lan.open({ id: 'mac', url: 'ws://127.0.0.1:47999', hello: JSON.stringify({ t: 'hello', key: 'wrong', device: { id: 'sim' } }), timeout: 2000 }).then(() => false, () => true);
    // The hello went before the connection was open and was lost now and then (3 of 4 runs on
    // 25.10.2026; LanPlugin.swift now says it once open). The runner's simulator takes seconds to
    // connect even to itself (the stand-in saw it 2-3 s late): up to 20 s, a second try allowed and told.
    const opening = performance.now();
    const hello = { id: 'mac', url: 'ws://127.0.0.1:47999', hello: JSON.stringify({ t: 'hello', key: 'smoke', device: { id: 'sim' } }), timeout: 20000 };
    const tries = await lan.open(hello).then(
      () => 1,
      () => lan.open(hello).then(() => 2),
    );
    const opened = performance.now() - opening;
    const at = performance.now();
    await lan.send({ id: 'mac', text: '{"t":"ping"}' });
    const back = await until(() => got.some((t) => t.includes('pong')), 3000);
    report('lan-link', refused && Boolean(back), `wrong key ${refused ? 'refused' : 'let in'}, open in ${opened.toFixed(0)} ms (try ${tries}), answer ${back ? `in ${(performance.now() - at).toFixed(0)} ms` : 'none'}`);
    await lan.close({ id: 'mac' });
  } catch (e) {
    report('lan-link', false, String(e));
  } finally {
    await listener.remove();
  }
}

/** Crossfade on the native player: near the end the next track starts on the other node while
 * this one fades out; then the new one plays alone. */
async function crossfade() {
  const { setCrossfade } = await import('./player/player.ts');
  const chart = (await (wave() as unknown as { api: { chart(): Promise<Track[]> } }).api.chart().catch(() => [] as Track[])).filter((t) => t.available !== false && (t.durationMs ?? 0) > 60000).slice(0, 2);
  if (chart.length < 2) return report('crossfade', false, 'no tracks to try');
  setCrossfade(4);
  try {
    await wave().playTracks(chart, 0, 'smoke crossfade');
    const audio = wave().audio;
    await until(() => !audio.paused && audio.currentTime > 1 && Number.isFinite(audio.duration), 60000);
    audio.currentTime = audio.duration - 6;
    const crossed = await until(async () => wave().usePlayer.getState().index === 1 && (await OniPlayer.state()).crossing, 30000);
    const alone = await until(async () => {
      const st = await OniPlayer.state();
      return !st.crossing && st.playing && st.time > 4;
    }, 20000);
    report('crossfade', crossed && alone, `${crossed ? 'crossed' : 'no crossing'}; ${JSON.stringify(await OniPlayer.state())}`);
    // The smart crossfade: the player finds where the music ends once the file is whole.
    const native = wave().audio as unknown as { musicEnd: number; duration: number };
    const found = await until(() => Number.isFinite(native.musicEnd), 30000);
    report('music-end', Boolean(found) && native.musicEnd > native.duration - 31 && native.musicEnd <= native.duration + 0.5, `music ends at ${native.musicEnd?.toFixed?.(1)} of ${native.duration?.toFixed?.(1)} s; ${JSON.stringify(await OniPlayer.state())}`);
  } finally {
    setCrossfade(0);
  }
}

/** Volume levelling on the native player: a quiet track is raised above full volume (its lift unit,
 * 5 dB for −20 LUFS with its peak at −6) and still plays; a loud one is not raised. */
async function levelling() {
  const chart = (await (wave() as unknown as { api: { chart(): Promise<Track[]> } }).api.chart().catch(() => [] as Track[])).filter((t) => t.available !== false).slice(0, 2);
  if (chart.length < 2) return report('levelling', false, 'no tracks to try');
  const audio = wave().audio;
  const lift = async (t: Track) => {
    await wave().playTracks([t], 0, 'smoke levelling');
    const t0 = await until(() => !audio.paused && audio.currentTime > 0.5, 60000);
    const at = audio.currentTime;
    await sleep(1500);
    const st = (await OniPlayer.state()) as { lift?: number; playing: boolean; time: number };
    return { lift: st.lift ?? NaN, playing: t0 && st.playing && audio.currentTime > at + 0.5 };
  };
  const quiet = await lift({ ...chart[0], r128: { i: -20, tp: -6 } });
  const loud = await lift({ ...chart[1], r128: { i: -5, tp: 1 } });
  audio.pause();
  report('levelling', Math.abs(quiet.lift - 5) < 0.05 && quiet.playing && loud.lift === 0 && loud.playing, JSON.stringify({ quiet, loud }));
}

/** «Своя волна»: on Home its button sits in one row with Play and Tune (its sign alone on the
 * iPhone), and it starts Oni's own station, played by the native player. */
async function ownWave() {
  click('[data-testid="nav-home"]');
  const button = await until(() => document.querySelector('[data-testid="own-wave"]'), 15000);
  const tops = [...document.querySelectorAll<HTMLElement>('.wave-actions .btn')].map((b) => Math.round(b.getBoundingClientRect().top));
  const oneRow = tops.length === 3 && new Set(tops).size === 1;
  click('[data-testid="own-wave"]');
  const player = (wave() as unknown as { usePlayer: { getState(): { source?: { station?: { seed: string } } } } }).usePlayer;
  const playing = await until(() => player.getState().source?.station?.seed === 'oni:own' && !wave().audio.paused && wave().audio.currentTime > 1, 60000);
  const widths = [...document.querySelectorAll<HTMLElement>('.wave-actions .btn')].map((b) => Math.round(b.getBoundingClientRect().width));
  const error = (wave().usePlayer.getState() as { error?: string | null }).error ?? '';
  report('own-wave', Boolean(button) && oneRow && playing, `buttons at ${tops.join('/')}, ${widths.join('+')} wide in ${Math.round(document.querySelector('.wave-actions')?.getBoundingClientRect().width ?? 0)}; ${playing ? 'playing' : `not playing (${error})`} "${wave().usePlayer.getState().queue[wave().usePlayer.getState().index]?.title ?? ''}"`);
}

/** The account's own upload Yandex keeps as "aac" (MP4 inside) plays: it would not open (the user, 25.10.2026). */
async function uploadPlays() {
  const w = wave() as unknown as { api: { uid(): Promise<number>; playlist(uid: unknown, kind: unknown): Promise<{ tracks?: { track?: Track }[] }>; stream(id: string, q: string): Promise<{ codec: string }> }; useApp: { getState(): { playlists: { uid: number; kind: number; owner?: { uid: number } }[] } } };
  const me = String(await w.api.uid());
  let found: Track | null = null;
  for (const p of w.useApp.getState().playlists.filter((x) => String(x.owner?.uid) === me)) {
    const full = await w.api.playlist(p.uid, p.kind).catch(() => null);
    for (const t of (full?.tracks ?? []).map((x) => x.track).filter((t): t is Track => t?.trackSource === 'UGC').slice(0, 8)) {
      if ((await w.api.stream(String(t.id), 'lossless').catch(() => null))?.codec === 'aac') {
        found = t;
        break;
      }
    }
    if (found) break;
  }
  if (!found) return report('upload-plays', true, 'no upload kept as aac on the account: nothing to try');
  await wave().playTracks([found], 0, 'smoke upload');
  const playing = await until(() => !wave().audio.paused && wave().audio.currentTime > 1, 30000);
  report('upload-plays', Boolean(playing), `"${found.title}" at ${wave().audio.currentTime.toFixed(1)} s`);
}

/** Settings → Voice commands: a button per shared shortcut, each opening its iCloud page (not followed). */
function voiceShortcuts() {
  const app = (window as unknown as { __wave: { navigate(r: unknown): void } }).__wave;
  app.navigate({ name: 'settings' });
  // Slow on the cloud Mac after a long page: 15 s (a run, 25.10.2026, had them at 5.x s).
  return until(() => document.querySelectorAll('[data-testid="voice-shortcut"]').length, 15000).then((ok) => {
    const n = document.querySelectorAll('[data-testid="voice-shortcut"]').length;
    const over = [...document.querySelectorAll<HTMLElement>('[data-testid="voice-shortcut"]')].filter((b) => b.getBoundingClientRect().right > window.innerWidth + 1).length;
    report('voice-shortcuts', Boolean(ok) && n === 2 && over === 0, `${n} buttons, ${over} off screen`);
  });
}

/** History → Recap on the phone: the numbers and the tops are there, and nothing runs off the screen. */
async function recap() {
  click('[data-testid="nav-history"]');
  await until(() => document.querySelector('[data-testid="history-recap"]'), 10000);
  click('[data-testid="history-recap"]');
  const shown = await until(() => document.querySelector('[data-testid="recap-track"], [data-testid="recap-empty"]'), 30000);
  const tracks = document.querySelectorAll('[data-testid="recap-track"]').length;
  const over = [...document.querySelectorAll<HTMLElement>('.recap-stat, .recap-track, .recap-head, .recap .lib-actions > *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length;
  report('recap', Boolean(shown) && over === 0, `${tracks} tracks, ${document.querySelectorAll('[data-testid="recap-artist"]').length} artists, ${over} off screen`);
  // As stories: full screen, a tap goes on; the last card offers iOS's share sheet.
  if (!tracks) return;
  click('[data-testid="recap-stories-open"]');
  const opened = await until(() => document.querySelector('[data-testid="story-card"]'), 3000);
  const card = document.querySelector<HTMLElement>('[data-testid="story-card"]');
  const full = card ? Math.abs(card.getBoundingClientRect().width - window.innerWidth) < 2 : false;
  let summary = false;
  for (let i = 0; i < 12 && !summary; i++) {
    const c = document.querySelector<HTMLElement>('[data-testid="story-card"]');
    if (c?.dataset.card === 'summary') summary = true;
    else {
      const r = c!.getBoundingClientRect();
      c!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.right - 20, clientY: r.top + r.height / 2 }));
      await sleep(400);
    }
  }
  const share = document.querySelector<HTMLElement>('[data-testid="story-share"]');
  const shareOk = Boolean(share) && share!.getBoundingClientRect().bottom <= window.innerHeight;
  // Closed with a finger pulled down (the user: the close button was a reach), not the button.
  const c = document.querySelector<HTMLElement>('[data-testid="story-card"]')!;
  const r = c.getBoundingClientRect();
  const touch = (y: number) => ({ pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: r.left + r.width / 2, clientY: y, bubbles: true });
  c.dispatchEvent(new PointerEvent('pointerdown', touch(r.top + 200)));
  for (let y = 220; y <= 420; y += 40) {
    c.dispatchEvent(new PointerEvent('pointermove', touch(r.top + y)));
    await sleep(16);
  }
  c.dispatchEvent(new PointerEvent('pointerup', touch(r.top + 420)));
  const swiped = await until(() => !document.querySelector('[data-testid="recap-stories"]'), 3000);
  if (!swiped) click('[data-testid="stories-close"]');
  report('recap-stories', Boolean(opened) && full && summary && shareOk && swiped, `${full ? 'full screen' : 'not full screen'}, summary ${summary ? 'reached' : 'not reached'}, share ${shareOk ? 'there' : 'missing'}, ${swiped ? 'closed by a pull down' : 'a pull down did not close it'}`);
}

/** The beat pulse on the phone: the native player sends the bass, the page finds kicks in it and
 * Now Playing's cover throbs (Now Playing is open here, the music playing). */
async function iosPulse() {
  const { setPulse } = await import('./ui/motion.ts');
  const { pulseDebug, resetPulseDebug } = await import('./player/pulse.ts');
  resetPulseDebug();
  setPulse(true);
  // Up to 25 s, done at the first throb: a cloud Mac's beats come late and few (one to three in 20 s
  // at times), so the cover's highest throb is kept by the pulse itself (pulseDebug().peak), not
  // looked for every 40 ms, which missed them.
  await until(() => pulseDebug().peak > 0.2, 25000);
  const cover = Number((document.querySelector('.np-cover') as HTMLElement | null)?.style.getPropertyValue('--beat') || -1);
  const seen = pulseDebug();
  report('ios-pulse', seen.peak > 0.2 && cover >= 0, `peak ${seen.peak.toFixed(2)}, cover --beat ${cover} ${JSON.stringify(seen)}`);
}

/**
 * Fast start: a track not in the cache plays after a few seconds of it, not after the whole file
 * (the user's wish after 1.7.0). The download is held to ~200 KB/s, so the whole of it would take
 * half a minute: it starts within seconds, plays on without a stall (the network is faster than
 * the music), and a seek far ahead waits for the download, then plays from there.
 */
async function fastStart() {
  const chart = (await (wave() as unknown as { api: { chart(): Promise<Track[]> } }).api.chart().catch(() => [] as Track[]))
    .filter((t) => t.available !== false && (t.durationMs ?? 0) > 150000 && !wave().offline!.has(String(t.id)))
    .slice(12, 13);
  if (!chart.length) return report('fast-start', false, 'no track to try');
  await OniPlayer.testThrottle({ bytesPerSecond: 200_000 });
  try {
    const t0 = Date.now();
    await wave().playTracks(chart, 0, 'smoke fast start');
    const audio = wave().audio;
    const started = await until(() => !audio.paused && audio.currentTime > 0.5, 30000);
    const startedIn = (Date.now() - t0) / 1000;
    const first = await OniPlayer.state();
    await sleep(8000);
    const later = await OniPlayer.state();
    const steady = later.playing && !later.waiting && later.time - first.time > 6;
    // Far ahead: past what has come; it waits, then plays from there.
    const target = audio.duration * 0.7;
    audio.currentTime = target;
    await sleep(1500);
    const waited = await OniPlayer.state();
    const resumed = await until(async () => {
      const st = await OniPlayer.state();
      return st.playing && !st.waiting && st.time > target + 1;
    }, 90000);
    const end = await OniPlayer.state();
    report(
      'fast-start',
      // Started on a part of the file is what counts; the time, on a cloud Mac at times slow, only
      // has to beat the whole download (~30 s at the held speed): 8 s failed at 9 and at 20 s.
      started && startedIn < 25 && Boolean(first.streaming) && (first.received ?? 0) < (first.expected ?? 0) && steady && resumed,
      `started in ${startedIn.toFixed(1)} s with ${Math.round((first.received ?? 0) / 1024)} of ${Math.round((first.expected ?? 0) / 1024)} KB; 8 s later ${later.time.toFixed(1)} s${later.waiting ? ' (waiting)' : ''} ${JSON.stringify((later as { trace?: unknown }).trace)}; seek to ${target.toFixed(0)} s: ${waited.waiting ? 'waited' : 'no wait'}, then ${end.time.toFixed(1)} s`,
    );
  } finally {
    await OniPlayer.testThrottle({ bytesPerSecond: 0 });
  }
}

/**
 * Siri and Shortcuts (OniIntents.swift): their commands go the lock screen's way (RemotePlugin.press),
 * pressed here: next moves the queue on, My Wave starts the wave (the actions themselves need Siri
 * or the Shortcuts app, which the simulator run has not).
 */
async function intents() {
  const st = () => wave().usePlayer.getState() as unknown as { index: number; queue: unknown[]; source?: { kind: string; station?: unknown } };
  const chart = (await (wave() as unknown as { api: { chart(): Promise<Track[]> } }).api.chart().catch(() => [] as Track[])).filter((t) => t.available !== false).slice(0, 3);
  await wave().playTracks(chart, 0, 'smoke intents');
  await until(() => !wave().audio.paused, 30000);
  await OniRemote.press({ name: 'next' });
  const moved = await until(() => st().index === 1, 10000);
  await OniRemote.press({ name: 'wave' });
  const waved = await until(() => st().source?.kind === 'wave' && !st().source?.station && !wave().audio.paused, 30000);
  report('intents', moved && waved, `next ${moved ? 'moved' : 'did not move'}, My Wave ${waved ? 'playing' : `not playing (${st().source?.kind})`}`);
}

/** Does the page keep running while the app is in the background with the native player on? The
 * workflow sends the app away for 25 s and back; a tick every 2 s shows whether this page ran.
 * Away, the player's clock comes once a second and no beat at all, even with the pulse asked for
 * (a night of them was a flood; the user's black screen in the morning). Back, the shell asks the
 * page whether it shows anything: this one says no, as a black page would, and must be loaded
 * anew, the music going on (`revived` below). */
function backgroundProbe() {
  let hiddenAt = 0;
  let timeAt = 0;
  let indexAt = 0;
  let ticks = 0;
  let times = 0;
  let beats = 0;
  setInterval(() => document.hidden && ticks++, 2000);
  OniPlayer.addListener('time', () => document.hidden && times++);
  OniPlayer.addListener('beat', () => document.hidden && beats++);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      timeAt = wave().audio.currentTime;
      indexAt = wave().usePlayer.getState().index;
      ticks = times = beats = 0;
      OniPlayer.pulse({ on: true }).catch(() => {});
      sessionStorage.setItem(REVIVE, String(Date.now()));
      (window as { __oniAlive?: () => boolean }).__oniAlive = () => false;
      return;
    }
    const away = (Date.now() - hiddenAt) / 1000;
    const played = wave().audio.currentTime - timeAt;
    // A short track may end while away: the next one playing is the music going on too.
    const next = wave().usePlayer.getState().index > indexAt;
    console.log(`SMOKE background-life ${played > away / 2 || next ? 'ok' : 'FAIL'} away ${away.toFixed(0)} s, music moved ${played.toFixed(0)} s${next ? ' (on to the next track)' : ''}, page ticks ${ticks}`);
    report('background-quiet', times <= away * 1.5 && beats === 0, `${times} clock messages and ${beats} beats in ${away.toFixed(0)} s away`);
    OniPlayer.pulse({ on: false }).catch(() => {});
  });
}

/** The iPhone's equalizer is the system's (AVAudioUnitEQ), not Web Audio: does it do what the
 * official app's does with the same settings (asked by the user)? Measured with pure tones,
 * set up as Oni plays and in a few other ways, against Yandex's curve (eqCurve.ts). */
async function eqMatch() {
  const frequencies: number[] = [];
  for (let f = 30; f <= 18000; f *= Math.pow(2, 1 / 3)) frequencies.push(Math.round(f));
  const worstOff = async (gains: number[], shape: EqShape) => {
    const { db } = await OniPlayer.eqResponse({ gains, preamp: 0, frequencies, ...shape });
    let worst = 0;
    let at = 0;
    db.forEach((d, i) => {
      const off = Math.abs(d - eqResponse(gains, 0, frequencies[i], EQ_Q, 48000));
      if (off > worst) [worst, at] = [off, frequencies[i]];
    });
    return { worst, at, db };
  };
  // Each band alone at +6 dB, as Oni plays: which of them strays from Yandex's curve.
  const bands: string[] = [];
  for (let i = 0; i < 10; i++) {
    const gains = Array.from({ length: 10 }, (_, j) => (j === i ? 6 : 0));
    const { worst, at } = await worstOff(gains, {});
    bands.push(`${i}:${worst.toFixed(1)}@${at}`);
  }
  console.log(`SMOKE eq-bands ${bands.join(' ')}`);
  const curves = { mine: EQ_PRESETS.mine, rock: EQ_PRESETS.rock, zigzag: [8, -8, 8, -8, 8, -8, 8, -8, 8, -8] };
  const ways: [string, EqShape][] = [
    ['as Oni plays', {}],
    ['widths for 44.1 kHz', { widthRate: 44100 }],
    ['one width 1.3885', { bandwidth: 1.3885 }],
    ['one width 1 (1.10.0)', { bandwidth: 1 }],
  ];
  let asPlays = Infinity;
  for (const [way, shape] of ways) {
    const parts: string[] = [];
    let worstOfWay = 0;
    for (const [name, gains] of Object.entries(curves)) {
      const { worst, at, db } = await worstOff(gains, shape);
      worstOfWay = Math.max(worstOfWay, worst);
      parts.push(`${name} ${worst.toFixed(2)} dB at ${at} Hz`);
      if (name === 'mine' && way === 'as Oni plays') console.log(`SMOKE eq-curve mine: ${frequencies.map((f, i) => `${f}:${db[i].toFixed(1)}/${eqResponse(gains, 0, f, EQ_Q, 48000).toFixed(1)}`).join(' ')}`);
    }
    if (way === 'as Oni plays') asPlays = worstOfWay;
    console.log(`SMOKE eq-way ${way}: ${parts.join(', ')}`);
  }
  report('eq-match', asPlays <= 1, `the system equalizer as Oni plays is at most ${asPlays.toFixed(2)} dB off the official app's curve`);
}

/** Now Playing's equalizer button is red while the equalizer is on, as on the desktop (the user). */
async function eqButton() {
  const { setEqEnabled, useEq } = await import('./player/eq.ts');
  const app = (window as unknown as { __wave: { useApp: { setState(s: object): void } } }).__wave.useApp;
  const was = useEq.getState().enabled;
  app.setState({ nowPlayingOpen: true });
  await until(() => document.querySelector('[data-testid="np-sound"]'), 5000);
  const lit = async (on: boolean) => {
    setEqEnabled(on);
    await sleep(300);
    return document.querySelector('[data-testid="np-sound"]')?.classList.contains('on') ?? null;
  };
  const whenOn = await lit(true);
  const whenOff = await lit(false);
  setEqEnabled(was);
  app.setState({ nowPlayingOpen: false });
  report('eq-button', whenOn === true && whenOff === false, `on: ${whenOn}, off: ${whenOff}`);
}

/** Set by the background probe just before the page says it shows nothing. */
const REVIVE = 'oni-smoke-revive';

/** The page loaded anew by the shell after it said it showed nothing: it shows Oni again, and the
 * native player, which never stopped, is seen playing. */
async function revived() {
  sessionStorage.removeItem(REVIVE);
  const shown = await until(() => document.querySelector('[data-testid="nav-home"]'), 30000);
  // Slow on the cloud Mac: the page loads anew and takes the playing track up (45 s of the run's 60).
  const playing = await until(() => wave()?.audio && !wave().audio.paused, 45000);
  report('revived', shown && playing, `page ${shown ? 'shown' : 'not shown'}, music ${playing ? 'playing' : 'not seen playing'}`);
}

/** Now Playing shows the track's name whole (the user, 25.10.2026: "Am I …" was cut by the buttons
 * beside it), a long one too; the cover stays square, and all down to the last control is on screen. */
async function npTitle() {
  const store = wave().usePlayer as unknown as { getState(): { queue: { title: string }[]; index: number }; setState(s: object): void };
  const { queue, index } = store.getState();
  const seen: string[] = [];
  let ok = true;
  try {
    for (const title of ['Am I Ever Gonna Find Out', 'Am I Ever Gonna Find Out (Live from the Stanley Climbfall Sessions, 2002)']) {
      store.setState({ queue: queue.map((t, i) => (i === index ? { ...t, title } : t)) });
      await sleep(500);
      const h1 = document.querySelector<HTMLElement>('.nowplaying .np-text h1');
      const cover = document.querySelector('.nowplaying .np-cover')?.getBoundingClientRect();
      const stage = document.querySelector<HTMLElement>('.nowplaying .np-stage');
      const last = document.querySelector('.nowplaying .np-art')?.lastElementChild?.getBoundingClientRect();
      if (!h1 || !cover || !stage || !last) {
        ok = false;
        seen.push(`"${title}": not shown`);
        continue;
      }
      const floor = stage.getBoundingClientRect().bottom - parseFloat(getComputedStyle(stage).paddingBottom);
      const whole = h1.textContent === title && h1.scrollHeight <= h1.clientHeight + 1 && h1.scrollWidth <= h1.clientWidth + 1;
      const square = Math.abs(cover.width - cover.height) < 2 && cover.width > 150;
      const fits = last.bottom <= floor + 1 && cover.top >= stage.getBoundingClientRect().top;
      ok &&= whole && square && fits;
      seen.push(`${title.length} chars: ${whole ? 'whole' : `cut (${h1.scrollHeight}/${h1.clientHeight})`}, cover ${cover.width.toFixed(0)}×${cover.height.toFixed(0)}, last control ${last.bottom.toFixed(0)} of ${floor.toFixed(0)}`);
    }
  } finally {
    store.setState({ queue });
  }
  report('np-title', ok, seen.join('; '));
}

/** Now Playing's seek bar: a tap in its middle (not on the thumb) takes the track there, once,
 * when the finger lifts (src/ui/touchRange.ts, SeekBar). */
async function touchSeek() {
  const bar = document.querySelector<HTMLInputElement>('.nowplaying .np-seek input[type=range]');
  if (!bar) return report('touch-seek', false, 'no seek bar');
  const box = bar.getBoundingClientRect();
  const at = { pointerId: 11, pointerType: 'touch', isPrimary: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true };
  bar.dispatchEvent(new PointerEvent('pointerdown', at));
  // While the finger holds the bar, the left label says the time it goes to, lit.
  bar.dispatchEvent(new PointerEvent('pointermove', { ...at, clientX: at.clientX + 2 }));
  bar.dispatchEvent(new PointerEvent('pointermove', at));
  await sleep(100);
  const label = document.querySelector('.nowplaying [data-testid="seek-time"]');
  const tip = label?.classList.contains('seeking') ? (label.textContent ?? '') : '';
  bar.dispatchEvent(new PointerEvent('pointerup', at));
  const half = wave().audio.duration / 2;
  const moved = await until(() => Math.abs(wave().audio.currentTime - half) < 5, 5000);
  report('touch-seek', moved && /^\d+:\d\d$/.test(tip), `at ${wave().audio.currentTime.toFixed(1)} of ${wave().audio.duration.toFixed(1)}; held label "${tip}"`);
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

/** A sideways swipe along the player bar turns the track (src/ui/swipe.ts, useSwipeTrack; the user,
 * 26.10.2026, as in Yandex Music's app): left, the next one; right, back to the one before. */
async function swipeTrack() {
  const app = (window as unknown as { __wave: { useApp: { setState(s: object): void }; usePlayer: { getState(): { index: number; queue: { id: string }[] } } } }).__wave;
  app.useApp.setState({ nowPlayingOpen: false });
  await until(() => !document.querySelector('.nowplaying'), 3000);
  const bar = document.querySelector<HTMLElement>('.playerbar');
  const target = document.querySelector('.playerbar .pb-meta');
  const { index, queue } = app.usePlayer.getState();
  if (!bar || !target || index + 1 >= queue.length) return report('swipe-track', false, `bar ${Boolean(bar)}, ${index + 1} of ${queue.length}`);
  const swipe = async (xs: number[], hold = false) => {
    const y = bar.getBoundingClientRect().top + 20;
    const touch = (x: number) => new Touch({ identifier: 4, target, clientX: x, clientY: y });
    target.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(xs[0])], changedTouches: [touch(xs[0])], bubbles: true, cancelable: true }));
    for (const x of xs.slice(1)) target.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(x)], changedTouches: [touch(x)], bubbles: true, cancelable: true }));
    // the neighbour's card beside the bar while the finger is down (the carousel)
    const peer = document.querySelector<HTMLElement>(`.pb-peer[data-side="${xs[1] < xs[0] ? 'next' : 'prev'}"]`);
    peers.push(Boolean(peer && peer.style.visibility === 'visible' && Math.abs(peer.getBoundingClientRect().left - bar.getBoundingClientRect().left) < bar.clientWidth + 20));
    if (hold) await picture('carousel');
    target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(xs[xs.length - 1])], bubbles: true, cancelable: true }));
  };
  const peers: boolean[] = [];
  const w = bar.clientWidth;
  await swipe([w * 0.8, w * 0.75, w * 0.6, w * 0.4], true);
  const forward = await until(() => app.usePlayer.getState().index === index + 1, 4000);
  await sleep(600);
  await swipe([w * 0.2, w * 0.25, w * 0.4, w * 0.6]);
  const back = await until(() => app.usePlayer.getState().index === index, 4000);
  report('swipe-track', Boolean(forward) && Boolean(back) && peers.every(Boolean) && !document.querySelector('.nowplaying'), `${index} → ${forward ? index + 1 : '?'} → ${app.usePlayer.getState().index} of ${queue.length}; the neighbour's card beside it: ${peers.join(', ')}`);
}

/** Playlist import on the phone (src/views/Import.tsx): a pasted list is found in Yandex Music, and a
 * Spotify link is read through the phone's own requests (CapacitorHttp; YouTube's is a JSON post).
 * Nothing is made in the account. */
async function importList() {
  const w = wave() as unknown as { navigate(r: unknown): void };
  const type = (text: string) => {
    const box = document.querySelector<HTMLTextAreaElement>('[data-testid="import-input"]');
    if (!box) return false;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  const rows = (state?: string) => document.querySelectorAll(`[data-testid="import-row"]${state ? `[data-state="${state}"]` : ''}`).length;
  w.navigate({ name: 'import' });
  await until(() => document.querySelector('[data-testid="import-input"]'), 5000);
  type('Кино — Группа крови\nDaft Punk — One More Time');
  await sleep(100);
  click('[data-testid="import-find"]');
  const found = await until(() => rows('found') === 2, 30000);
  await picture('import');
  report('import-list', Boolean(found), `${rows('found')} of ${rows()} found`);
  w.navigate({ name: 'home' });
  await sleep(300);
  for (const [name, link, least] of [
    ['import-spotify', 'https://open.spotify.com/playlist/37i9dQZF1DX5Ejj0EkURtP', 50],
    ['import-youtube', 'https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i', 50],
  ] as const) {
    w.navigate({ name: 'import' });
    await until(() => document.querySelector('[data-testid="import-input"]'), 5000);
    type(link);
    await sleep(100);
    click('[data-testid="import-find"]');
    await until(() => rows() >= least || document.querySelector('[data-testid="import-error"]'), 30000);
    const error = document.querySelector('[data-testid="import-error"]')?.textContent;
    report(name, rows() >= least, error ?? `${rows()} tracks read`);
    w.navigate({ name: 'home' });
    await sleep(300);
  }
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
  // "Move" comes once the whole list is in (a part cannot be put in order): asked again till then.
  let items: (string | undefined)[] = [];
  await until(async () => {
    click('[data-testid="liked-more"]');
    await until(() => document.querySelector('.menu'), 3000);
    items = [...document.querySelectorAll('.menu .menu-item')].map((i) => i.textContent?.trim());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await until(() => !document.querySelector('.menu'), 2000);
    return items.some((i) => /изменить порядок|reorder/i.test(i ?? ''));
  }, 30000);
  report('liked-radio', items.some((i) => /радио|radio/i.test(i ?? '')), items.join(', '));
  // Not tried on the real Liked: it would put the account's likes in another order.
  report('liked-move', items.some((i) => /изменить порядок|reorder/i.test(i ?? '')), items.join(', '));
  // Downloading Liked: its row of buttons still fits the screen ("…" ran off it with the count
  // in the button: the user on 1.6.1). Started and cancelled at once (only the simulator's files).
  const download = document.querySelector<HTMLElement>('.lib-actions [data-testid="download-all"]');
  let busyOver = -1;
  if (download && !download.dataset.done) {
    download.click();
    if (await until(() => document.querySelector('.lib-actions [data-testid="download-all"].busy'), 10000)) {
      await sleep(1500);
      busyOver = [...document.querySelectorAll<HTMLElement>('.lib-actions > *')].filter((b) => b.getBoundingClientRect().right > window.innerWidth + 1).length;
      document.querySelector<HTMLElement>('.lib-actions [data-testid="download-all"]')?.click();
    }
  }
  report('liked-download-fits', busyOver === 0, busyOver < 0 ? 'no download started' : `${busyOver} off screen while downloading`);
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

/** Moving tracks on the phone: "Move" in a track's "…" shows handles, a drag by one moves the
 * track (a temporary playlist, deleted after); Now Playing has its queue as a sheet. */
async function moveTracks() {
  type Api = { createPlaylist(t: string): Promise<{ uid: number; kind: number }>; chart(): Promise<Track[]>; addToPlaylist(p: unknown, t: Track[], at: number): Promise<unknown>; deletePlaylist(k: number): Promise<void> };
  const w = window as unknown as { __wave: { api: Api; navigate(r: unknown): void } };
  const pl = await w.__wave.api.createPlaylist('oni-smoke-move');
  try {
    const chart = (await w.__wave.api.chart()).filter((t) => t.available !== false).slice(0, 3);
    await w.__wave.api.addToPlaylist(pl, chart, 0);
    w.__wave.navigate({ name: 'playlist', uid: pl.uid, kind: pl.kind });
    await until(() => document.querySelectorAll('.track-row').length === 3, 15000);
    const ids = () => [...document.querySelectorAll<HTMLElement>('.track-row')].map((r) => r.dataset.trackId);
    const before = ids();
    const menuItems = () => [...document.querySelectorAll<HTMLElement>('.menu .menu-item')];
    const isMove = (i: HTMLElement) => /переместить|изменить порядок|move|reorder/i.test(i.textContent ?? '');
    // "Reorder" is the list's, in the page's "…" (the user's wish after 1.6.0), not a track's.
    const first = document.querySelector('.track-row')!;
    const box = first.getBoundingClientRect();
    first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 60, clientY: box.top + 20 }));
    await until(() => document.querySelector('.menu'), 3000);
    const inTrack = menuItems().some(isMove);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await until(() => !document.querySelector('.menu'), 2000);
    click('[data-testid="playlist-more"]');
    await until(() => document.querySelector('.menu'), 3000);
    const item = menuItems().find(isMove);
    item?.click();
    const handles = await until(() => document.querySelectorAll('[data-testid="drag-handle"]').length === 3, 3000);
    // The user's way: a finger held on the track itself (its title), then moved. No track menu on
    // the hold (it opened and stopped the drag): the list is being edited.
    const grip = document.querySelector('.track-row .tr-title')!;
    const h = grip.getBoundingClientRect();
    const third = document.querySelectorAll('.track-row')[2].getBoundingClientRect();
    const at = (y: number) => ({ pointerId: 21, pointerType: 'touch', isPrimary: true, clientX: h.left + 20, clientY: y, bubbles: true, cancelable: true });
    grip.dispatchEvent(new PointerEvent('pointerdown', at(h.top + h.height / 2)));
    await sleep(700);
    const menuOnHold = Boolean(document.querySelector('.menu'));
    const dragging = Boolean(document.querySelector('.track-list.sorting'));
    // Then dragged onto the lower half of the third.
    for (let k = 1; k <= 6; k++) window.dispatchEvent(new PointerEvent('pointermove', at(h.top + ((third.top + third.height * 0.8 - h.top) * k) / 6)));
    window.dispatchEvent(new PointerEvent('pointerup', at(third.top + third.height * 0.8)));
    const want = [before[1], before[2], before[0]].join();
    const movedOk = await until(() => ids().join() === want, 5000);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    click('[data-testid="reorder-done"]');
    report(
      'move-tracks',
      !inTrack && Boolean(item) && Boolean(handles) && !menuOnHold && dragging && Boolean(movedOk),
      `in a track's menu ${inTrack ? 'yes' : 'no'}, in "…" ${item ? 'yes' : 'no'}, handles ${document.querySelectorAll('[data-testid="drag-handle"]').length}, menu on hold ${menuOnHold ? 'yes' : 'no'}, held row dragging ${dragging ? 'yes' : 'no'}, order ${ids().join()} want ${want}`,
    );
  } finally {
    await w.__wave.api.deletePlaylist(pl.kind).catch(() => {});
  }
  // The queue as a sheet over Now Playing, with handles.
  click('.pb-cover');
  await until(() => document.querySelector('[data-testid="np-queue"]'), 5000);
  // The lyrics in Now Playing itself (variant B, the user 26.10.2026): the cover shrinks into the
  // name's row and the lyrics take its place; a swipe down on the name goes back to the cover.
  const lyricsButton = document.querySelector<HTMLButtonElement>('[data-testid="np-lyrics"]');
  if (lyricsButton) {
    click('[data-testid="np-lyrics"]');
    const sung = await until(() => document.querySelector('[data-testid="np-sung"] .lyric, [data-testid="np-sung"] .lyrics-plain, [data-testid="np-sung"] [data-testid="lyrics-genius"]'), 20000);
    const lines = document.querySelectorAll('[data-testid="np-sung"] .lyric').length;
    const from = document.querySelector('[data-testid="np-sung"] [data-testid="lyrics-source"]') ? 'LRCLIB' : 'Yandex';
    const small = Math.round(document.querySelector('.nowplaying.sung .np-cover')?.getBoundingClientRect().width ?? 0);
    await picture('lyrics');
    const meta = document.querySelector('.nowplaying .np-meta')!;
    const touch = (y: number) => new Touch({ identifier: 5, target: meta, clientX: 200, clientY: y });
    meta.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(120)], changedTouches: [touch(120)], bubbles: true, cancelable: true }));
    meta.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [touch(260)], bubbles: true, cancelable: true }));
    const back = await until(() => !document.querySelector('.nowplaying.sung') && document.querySelector('.nowplaying'), 3000);
    report('lyrics-sheet', Boolean(sung) && small === 56 && Boolean(back), `${!sung ? 'nothing shown' : lines ? `${lines} lines, ${from}` : document.querySelector('[data-testid="np-sung"] .lyrics-plain') ? `plain, ${from}` : 'none: Genius offered'}; the cover ${small} px; a swipe down ${back ? 'went back to it' : 'did not go back'}`);
  } else report('lyrics-sheet', false, 'no lyrics button');
  click('[data-testid="np-queue"]');
  const sheet = await until(() => document.querySelector('[data-testid="queue-sheet"] [data-testid="drag-handle"]'), 3000);
  // Each handle on its track's line, at the right (it fell under the track: the user's screenshot).
  const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="queue-sheet"] .q-row')].filter((r) => r.querySelector('[data-testid="drag-handle"]'));
  const misplaced = rows.filter((r) => {
    const g = r.querySelector('[data-testid="drag-handle"]')!.getBoundingClientRect();
    const title = r.querySelector('.tr-main')!.getBoundingClientRect();
    const mid = g.top + g.height / 2;
    return mid < title.top || mid > title.bottom || g.left < title.right;
  }).length;
  report('queue-sheet', Boolean(sheet) && rows.length > 0 && !misplaced, `${rows.length} handles, ${misplaced} off their line`);
  // A track dragged down by its handle goes down; Now Playing stays (its swipe-down took the drag
  // and pulled the whole screen down: the user on 1.6.1).
  const queueIds = () => wave().usePlayer.getState().queue.map((t) => String(t.id));
  const qBefore = queueIds();
  const grip = rows[0]?.querySelector('[data-testid="drag-handle"]');
  const target = rows[2];
  let pulled = '';
  let qMoved = false;
  if (grip && target) {
    const g = grip.getBoundingClientRect();
    const t3 = target.getBoundingClientRect();
    const at = (y: number) => ({ pointerId: 31, pointerType: 'touch', isPrimary: true, clientX: g.left + g.width / 2, clientY: y, bubbles: true, cancelable: true });
    grip.dispatchEvent(new PointerEvent('pointerdown', at(g.top + g.height / 2)));
    for (let k = 1; k <= 6; k++) window.dispatchEvent(new PointerEvent('pointermove', at(g.top + ((t3.top + t3.height * 0.8 - g.top) * k) / 6)));
    pulled = (document.querySelector('.nowplaying') as HTMLElement | null)?.style.transform ?? 'closed';
    window.dispatchEvent(new PointerEvent('pointerup', at(t3.top + t3.height * 0.8)));
    qMoved = await until(() => queueIds().join() !== qBefore.join(), 3000);
  }
  await sleep(400);
  const npOpen = Boolean(document.querySelector('.nowplaying'));
  report('queue-drag-down', Boolean(grip && target) && !pulled && qMoved && npOpen, `Now Playing pulled "${pulled}", queue ${qMoved ? 'reordered' : 'unchanged'}, ${npOpen ? 'open' : 'closed'}`);
  (document.querySelector('.q-sheet-backdrop') as HTMLElement | null)?.click();
  click('.np-close');
}

/** Animations on, Liked and then History (the user, 25.10.2026: Oni started anew there): the page
 * slides in without a clip (fusuma-in-light), only the first rows of the long list come in one
 * after another, and the page is still the same one afterwards (iOS did not close it). */
async function animLight() {
  const { setAnimEnabled, useAnim } = await import('./ui/anim.ts');
  const was = useAnim.getState().enabled;
  const marker = Math.random();
  (window as unknown as { __oniPage: number }).__oniPage = marker;
  setAnimEnabled(true);
  try {
    click('[data-testid="nav-liked"]');
    const listed = await until(() => document.querySelectorAll('.track-row').length > 20, 30000);
    const slide = getComputedStyle(document.querySelector('.view-enter')!).animationName;
    const rows = [...document.querySelectorAll('.track-row')].slice(0, 21).map((r) => getComputedStyle(r).animationName);
    click('[data-testid="nav-history"]');
    await sleep(4000);
    const same = (window as unknown as { __oniPage?: number }).__oniPage === marker && Boolean(document.querySelector('[data-testid="nav-home"]'));
    report('anim-light', listed && slide === 'fusuma-in-light' && rows[0] === 'cascade-in' && rows[20] === 'none' && same, `slide "${slide}", rows "${rows[0]}" … "${rows[20]}", ${same ? 'same page' : 'page started anew'}`);
  } finally {
    setAnimEnabled(was);
    click('[data-testid="nav-home"]');
  }
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
  if (sessionStorage.getItem(REVIVE)) return revived();
  try {
    noZoom();
    noLoupe();
    await loginRedirect();
    report('home', await until(() => document.querySelector('.wave-hero'), 30000));
    // "Keep mine offline": Wi-Fi known (the simulator's network is not mobile data), its switch on by default.
    const { OniDownloads } = await import('./player/iosDownloads.ts');
    const net = await OniDownloads.network().catch((e) => ({ error: String(e) }));
    const { useAutoOwn } = await import('./ui/ownOffline.ts');
    report('own-offline', 'satisfied' in net && net.satisfied && !net.expensive && useAutoOwn.getState().on, JSON.stringify({ ...net, on: useAutoOwn.getState().on }));
    // Oni's data in IndexedDB, not the page's ~5 MB localStorage (it filled up on the user's phone, 25.10.2026).
    report('storage', storage.kind === 'indexeddb', `${storage.kind}; in localStorage: ${Object.keys(localStorage).filter((k) => !k.startsWith('ui.')).length} of Oni's entries`);
    phoneLayout();
    buttonNames('home');
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
    await npTitle();
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
    await awakeAfterPause();
    await twice(lanLink);
    await twice(iosPulse);
    await crossfade();
    await levelling();
    await uploadPlays();
    await twice(fastStart);
    await intents();
    await backgroundDownload();
    await ownWave();

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
    await sleep(1100);
    await holdHint();
    buttonNames('search');
    await sleep(1100);
    await uploadForm();
    await textResponse();
    await playlistActions();
    await swipeBack();
    await importList();
    await swipeTrack();
    await phoneTop();
    await moveTracks();
    // The Taptic Engine's plugin is there and answers (the simulator has nothing to feel).
    const { OniHaptics } = await import('./ui/haptics.ts');
    const tapped = await OniHaptics.tap({ kind: 'pick' }).then(() => '', (e) => String(e));
    report('haptics', !tapped, tapped);
    await holdHintRound();
    await twice(recap);
    await eqMatch().catch((e) => report('eq-match', false, String(e)));
    await eqButton().catch((e) => report('eq-button', false, String(e)));
    await voiceShortcuts();
    await animLight().catch((e) => report('anim-light', false, String(e)));
    await updateCheck();
  } catch (e) {
    report('crash', false, String(e));
  }
  backgroundProbe();
  console.log('SMOKE done');
}
