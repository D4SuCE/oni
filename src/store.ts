// App-level state: auth, navigation, library (likes, playlists), toasts.

import { create } from 'zustand';
import type { Account, Playlist, Track } from './api/types.ts';
import { api, loadJson, storage, transport } from './api/client.ts';
import { ApiError, trackKey } from './api/yandex.ts';
import { tr, useLang } from './i18n.ts';
import { dropFromQueue, onNetworkLost, setDislikedCheck, setOfflineMode, waveFeedback } from './player/player.ts';

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
  liked: Set<string>;
  likedKeys: string[];
  disliked: Set<string>;
  playlists: Playlist[];
  likedPlaylists: Playlist[];
  /** Likes and playlists have been loaded at least once. */
  libraryReady: boolean;
  /** No network: started from the cached account, only downloaded tracks play. */
  offline: boolean;
  toast: { id: number; text: string } | null;
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

export function navigate(route: Route) {
  const s = get();
  if (JSON.stringify(s.route) === JSON.stringify(route)) return;
  set({ route, backStack: [...s.backStack.slice(-30), s.route], forwardStack: [], nowPlayingOpen: false });
}

export function back() {
  const s = get();
  const prev = s.backStack[s.backStack.length - 1];
  if (prev) set({ route: prev, backStack: s.backStack.slice(0, -1), forwardStack: [...s.forwardStack, s.route], nowPlayingOpen: false });
}

export function forward() {
  const s = get();
  const next = s.forwardStack[s.forwardStack.length - 1];
  if (next) set({ route: next, forwardStack: s.forwardStack.slice(0, -1), backStack: [...s.backStack.slice(-30), s.route], nowPlayingOpen: false });
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
export function toast(text: string) {
  const id = ++toastSeq;
  set({ toast: { id, text } });
  setTimeout(() => get().toast?.id === id && set({ toast: null }), 3200);
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
  } catch (e) {
    // No network (not a refused token): start from what was saved last time, with the downloads.
    const cached = loadJson<Account | null>(ACCOUNT_CACHE, null);
    if (!(e instanceof ApiError) && cached) return goOffline(cached);
    toast(tr().toast.loginFailed(errorText(e)));
    set({ auth: 'login' });
  }
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
  if (await transport.login(useLang.getState().lang)) await init();
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
    toast(tr().toast.disliked);
  } catch (e) {
    toast(tr().common.failed(errorText(e)));
  }
}

export async function undislike(t: Track) {
  const disliked = new Set(get().disliked);
  disliked.delete(String(t.id));
  set({ disliked });
  await api.setDisliked([trackKey(t)], false).catch((e) => toast(errorText(e)));
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
