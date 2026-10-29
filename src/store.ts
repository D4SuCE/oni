// App-level state: auth, navigation, library (likes, playlists), toasts.

import { create } from 'zustand';
import type { Account, Playlist, Track } from './api/types.ts';
import { api, loadJson, storage, transport } from './api/client.ts';
import { ApiError, trackKey } from './api/yandex.ts';
import { tr, useLang } from './i18n.ts';
import { dropFromQueue, offline, onNetworkLost, setDislikedCheck, setLikedCheck, setOfflineMode, usePlayer, warmWave, waveFeedback } from './player/player.ts';
import { connectDisk, startSync } from './sync/index.ts';
import { checkWaiting } from './import/run.ts';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library'; tab?: LibraryTab }
  | { name: 'album'; id: number | string }
  | { name: 'artist'; id: number | string }
  | { name: 'playlist'; uid: number | string; kind: number | string }
  | { name: 'history' }
  | { name: 'mix'; id: string }
  | { name: 'downloads' }
  | { name: 'import' }
  | { name: 'shared'; link: string; owner?: string }
  | { name: 'backup' }
  | { name: 'settings' };

/** `downloads`: the iPhone shows Downloads as a Collection tab (the desktop has its own page). */
export type LibraryTab = 'tracks' | 'playlists' | 'albums' | 'artists' | 'downloads';

interface AppState {
  auth: 'loading' | 'login' | 'ready';
  account: Account | null;
  route: Route;
  backStack: Route[];
  /** Pages left with Back, for Forward (cleared by any new navigation, as in a browser). */
  forwardStack: Route[];
  /** Which way the last move went: a page slides in from the right going forward, from the left back. */
  navDir: 'forward' | 'back';
  liked: Set<string>;
  likedKeys: string[];
  disliked: Set<string>;
  playlists: Playlist[];
  likedPlaylists: Playlist[];
  /** Likes and playlists have been loaded at least once. */
  libraryReady: boolean;
  /** No network: started from the cached account, only downloaded tracks play. */
  offline: boolean;
  /** With a button ("Undo") when `action` is there. */
  toast: { id: number; text: string; action?: { label: string; run: () => void } } | null;
  nowPlayingOpen: boolean;
  tuningOpen: boolean;
  soundOpen: boolean;
  searchQuery: string;
}

export const useApp = create<AppState>(() => ({
  auth: 'loading',
  account: null,
  route: { name: 'home' },
  backStack: [],
  forwardStack: [],
  navDir: 'forward',
  liked: new Set(),
  likedKeys: [],
  disliked: new Set(),
  playlists: [],
  likedPlaylists: [],
  libraryReady: false,
  offline: false,
  toast: null,
  nowPlayingOpen: false,
  tuningOpen: false,
  soundOpen: false,
  searchQuery: '',
}));

const set = useApp.setState;
const get = useApp.getState;

setDislikedCheck((id) => get().disliked.has(id));
setLikedCheck((id) => get().liked.has(id));
// The wave's filters ran dry and a known track plays after all: said once a wave, not silently
// (the user, with "Only new" on: "tracks heard three times come again").
usePlayer.subscribe((s, prev) => {
  if (s.waveStats?.relaxed === 1 && !prev.waveStats?.relaxed) toast(tr().wave.nothingNew);
});

export function navigate(route: Route) {
  const s = get();
  if (JSON.stringify(s.route) === JSON.stringify(route)) return;
  set({ route, backStack: [...s.backStack.slice(-30), s.route], forwardStack: [], nowPlayingOpen: false, navDir: 'forward' });
}

export function back() {
  const s = get();
  const prev = s.backStack[s.backStack.length - 1];
  if (prev) set({ route: prev, backStack: s.backStack.slice(0, -1), forwardStack: [...s.forwardStack, s.route], nowPlayingOpen: false, navDir: 'back' });
}

function forward() {
  const s = get();
  const next = s.forwardStack[s.forwardStack.length - 1];
  if (next) set({ route: next, forwardStack: s.forwardStack.slice(0, -1), backStack: [...s.backStack.slice(-30), s.route], nowPlayingOpen: false, navDir: 'forward' });
}

let lastStep = 0;
/**
 * Back / forward from the keyboard, the mouse side buttons or the shell. On Windows a side
 * button can arrive both as a mouse event and as an app command; a repeat within 300 ms is
 * the same press.
 */
export function historyStep(dir: 'back' | 'forward') {
  const now = Date.now();
  if (now - lastStep < 300) return;
  lastStep = now;
  if (dir === 'back') back();
  else forward();
}

let toastSeq = 0;
export function toast(text: string, action?: { label: string; run: () => void }) {
  const id = ++toastSeq;
  set({ toast: { id, text, action } });
  // one with a button stays longer: time to press it
  setTimeout(() => get().toast?.id === id && set({ toast: null }), action ? 6000 : 3200);
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// --------------------------------------------------------------------- auth

export async function init() {
  if (!(await transport.hasToken())) {
    set({ auth: 'login' });
    return;
  }
  try {
    const account = await api.account(true);
    storage.setItem(ACCOUNT_CACHE, JSON.stringify(account));
    set({ account, auth: 'ready', offline: false });
    setOfflineMode(false);
    refreshLibrary();
    warmWave();
    // A room listened in a little while ago (the iPhone's Oni put to sleep) is joined again, once Disk is known.
    void startSync().then(() => import('./together/index.ts')).then((m) => m.resumeTogether());
    lookAgain();
  } catch (e) {
    // No network (not a refused token): start from what was saved last time, with the downloads.
    const cached = loadJson<Account | null>(ACCOUNT_CACHE, null);
    if (!(e instanceof ApiError) && cached) return goOffline(cached);
    toast(tr().toast.loginFailed(errorText(e)));
    set({ auth: 'login' });
  }
}

/** Tracks of imported playlists Yandex had not got: asked for again once a day, added to their
 * playlist once found (src/import/run.ts). A little after the start, so it does not slow it. */
function lookAgain() {
  // and one's own shared uploads catch up with the playlists (src/share; the desktop, sharing on)
  // (not from a test run: it would mark the account's playlists)
  setTimeout(() => void (transport.testMode || import('./share/owner.ts').then((m) => m.shareUploads())), 60_000);
  // and the downloads Yandex has taken away since: kept for good (ui/offline.ts)
  setTimeout(() => void import('./ui/offline.ts').then((m) => m.keepGoneDownloads()).catch(() => {}), 30_000);
  // and the day's backup of the library (src/backup), once the Disk is there; not from a test run
  setTimeout(() => {
    if (transport.testMode) return;
    void import('./sync/index.ts').then(({ useSync }) => useSync.getState().connected && import('./backup/backup.ts').then((m) => m.backUp())).catch(() => {});
  }, 90_000);
  setTimeout(() => {
    checkWaiting()
      .then((added) => {
        for (const [title, n] of added ?? []) toast(tr().transfer.addedLater(title, n));
        if (added?.size) refreshPlaylists();
      })
      .catch(() => {});
  }, 30_000);
}

const ACCOUNT_CACHE = 'app.account.v1';
const LIBRARY_CACHE = 'app.library.v1';
const RECONNECT = 20_000;

interface LibraryCache {
  likedKeys: string[];
  disliked: string[];
  playlists: Playlist[];
  likedPlaylists: Playlist[];
}

let reconnecting: ReturnType<typeof setInterval> | undefined;

function goOffline(account: Account) {
  const lib = loadJson<LibraryCache | null>(LIBRARY_CACHE, null);
  set({
    account,
    auth: 'ready',
    offline: true,
    libraryReady: true,
    // Liked, as in Yandex's app: its downloaded tracks play there in its order (Downloads stays a page).
    route: { name: 'library', tab: 'tracks' },
    ...(lib && {
      likedKeys: lib.likedKeys,
      liked: new Set(lib.likedKeys.map((k) => k.split(':')[0])),
      disliked: new Set(lib.disliked),
      playlists: lib.playlists,
      likedPlaylists: lib.likedPlaylists,
    }),
  });
  setOfflineMode(true);
  waitForNetwork();
}

/** Back online: the network event where there is one, and a retry every 20 s anyway. */
function waitForNetwork() {
  clearInterval(reconnecting);
  reconnecting = setInterval(reconnect, RECONNECT);
  window.addEventListener('online', reconnect);
}

/** The network went away while the app runs (a request that never reached Yandex, or the system
 * says so): offline as at a start without one, on the page the user is on. */
function lostNetwork() {
  if (get().auth !== 'ready' || get().offline) return;
  set({ offline: true });
  setOfflineMode(true);
  toast(tr().downloads.lostNetwork);
  waitForNetwork();
}
onNetworkLost(lostNetwork);
if (typeof window !== 'undefined') window.addEventListener('offline', lostNetwork);

async function reconnect() {
  if (!get().offline) return;
  try {
    await api.account(true);
  } catch {
    return;
  }
  clearInterval(reconnecting);
  window.removeEventListener('online', reconnect);
  set({ offline: false });
  setOfflineMode(false);
  refreshLibrary();
  toast(tr().downloads.backOnline);
}

export async function loginWithToken(token: string) {
  await transport.setToken(token);
  await init();
}

export async function loginWithYandex() {
  if (!transport.login) return;
  if (!(await transport.login(useLang.getState().lang))) return;
  await init();
  // The shared history and the remote at once (the user, 25.10.2026: "why not both at the first sign-in?").
  // Disk takes a token of Oni's own app at Yandex, not the music one, so it is a second page; signed in
  // already, it is one "Allow". Closed, Settings has the button as before.
  if (get().auth === 'ready' && transport.hasDiskToken && !(await transport.hasDiskToken())) await connectDisk();
}

export async function logout() {
  await transport.setToken(null);
  set({ auth: 'login', account: null, playlists: [], likedPlaylists: [], liked: new Set(), likedKeys: [] });
}

// ------------------------------------------------------------------ library

export async function refreshLibrary() {
  const [likedKeys, disliked, playlists, likedPlaylists] = await Promise.all([
    api.likedTrackKeys().catch(() => get().likedKeys),
    api.dislikedTrackIds().catch(() => [...get().disliked]),
    api.playlists().catch(() => get().playlists),
    api.likedPlaylists().catch(() => get().likedPlaylists),
  ]);
  // Covers for tracks downloaded before they were kept (in the background, once there is a network).
  offline?.fillCovers().catch(() => {});
  set({
    libraryReady: true,
    likedPlaylists,
    likedKeys,
    liked: new Set(likedKeys.map((k) => k.split(':')[0])),
    disliked: new Set(disliked),
    playlists,
  });
  // For a start without a network: the sidebar and likes as they were.
  storage.setItem(LIBRARY_CACHE, JSON.stringify({ likedKeys, disliked, playlists, likedPlaylists } satisfies LibraryCache));
}

export async function refreshPlaylists() {
  set({ playlists: await api.playlists() });
}

export async function toggleLike(t: Track) {
  // a friend's upload (src/share) is not Yandex's: there is nothing to like (Yandex refuses it)
  if (t.share) return;
  const id = String(t.id);
  const wasLiked = get().liked.has(id);
  const liked = new Set(get().liked);
  wasLiked ? liked.delete(id) : liked.add(id);
  const likedKeys = wasLiked ? get().likedKeys.filter((k) => k.split(':')[0] !== id) : [trackKey(t), ...get().likedKeys];
  set({ liked, likedKeys });
  try {
    await api.setLiked([trackKey(t)], !wasLiked);
    if (!wasLiked) {
      waveFeedback('like', t);
      if (get().disliked.has(id)) {
        const disliked = new Set(get().disliked);
        disliked.delete(id);
        set({ disliked });
      }
    }
  } catch (e) {
    toast(tr().common.failed(errorText(e)));
    refreshLibrary();
  }
}

export async function dislike(t: Track) {
  if (t.share) return;
  const id = String(t.id);
  const disliked = new Set(get().disliked);
  disliked.add(id);
  const liked = new Set(get().liked);
  liked.delete(id);
  set({ disliked, liked });
  dropFromQueue(id);
  waveFeedback('dislike', t);
  try {
    await api.setDisliked([trackKey(t)], true);
    // pressed by mistake: undone right here (the user, 27.10.2026: "can't bring it back")
    toast(tr().toast.disliked, { label: tr().toast.undo, run: () => void undislike(t) });
  } catch (e) {
    toast(tr().common.failed(errorText(e)));
  }
}

export async function undislike(t: Track) {
  const disliked = new Set(get().disliked);
  disliked.delete(String(t.id));
  set({ disliked });
  try {
    await api.setDisliked([trackKey(t)], false);
    toast(tr().toast.recommendedAgain);
  } catch (e) {
    toast(errorText(e));
  }
}

export async function addToPlaylist(pl: Playlist, t: Track) {
  try {
    // Revision must be fresh, otherwise Yandex rejects the diff.
    const fresh = await api.playlist(pl.uid, pl.kind);
    await api.addToPlaylist(fresh, [t], fresh.trackCount);
    toast(tr().toast.added(pl.title));
    refreshPlaylists();
  } catch (e) {
    toast(tr().toast.addFailed(errorText(e)));
  }
}

export async function createPlaylist(title: string) {
  const pl = await api.createPlaylist(title);
  await refreshPlaylists();
  return pl;
}

export function isOwn(pl: { uid: number | string }) {
  return String(pl.uid) === String(get().account?.uid);
}

/** Playlists are identified by owner + kind: kinds of different owners overlap. */
export const samePlaylist = (a: { uid: number | string; kind: number | string }, b: { uid: number | string; kind: number | string }) =>
  String(a.uid) === String(b.uid) && String(a.kind) === String(b.kind);

export async function togglePlaylistLike(pl: Playlist) {
  const before = get().likedPlaylists;
  const wasLiked = before.some((p) => samePlaylist(p, pl));
  set({ likedPlaylists: wasLiked ? before.filter((p) => !samePlaylist(p, pl)) : [pl, ...before] });
  try {
    await api.setPlaylistLiked(pl, !wasLiked);
    toast(wasLiked ? tr().toast.playlistRemoved : tr().toast.playlistSaved);
  } catch (e) {
    set({ likedPlaylists: before });
    toast(tr().common.failed(errorText(e)));
  }
}
