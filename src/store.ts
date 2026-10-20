// App-level state: auth, navigation, library (likes, playlists), toasts.

import { create } from 'zustand';
import type { Account, Playlist, Track } from './api/types.ts';
import { api, transport } from './api/client.ts';
import { trackKey } from './api/yandex.ts';
import { tr } from './i18n.ts';
import { dropFromQueue, setDislikedCheck, waveFeedback } from './player/player.ts';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'library'; tab?: LibraryTab }
  | { name: 'album'; id: number | string }
  | { name: 'artist'; id: number | string }
  | { name: 'playlist'; uid: number | string; kind: number | string }
  | { name: 'history' }
  | { name: 'mix'; id: string }
  | { name: 'settings' };

export type LibraryTab = 'tracks' | 'playlists' | 'albums' | 'artists';

interface AppState {
  auth: 'loading' | 'login' | 'ready';
  account: Account | null;
  route: Route;
  backStack: Route[];
  liked: Set<string>;
  likedKeys: string[];
  disliked: Set<string>;
  playlists: Playlist[];
  likedPlaylists: Playlist[];
  /** Likes and playlists have been loaded at least once. */
  libraryReady: boolean;
  toast: { id: number; text: string } | null;
  nowPlayingOpen: boolean;
  tuningOpen: boolean;
  searchQuery: string;
}

export const useApp = create<AppState>(() => ({
  auth: 'loading',
  account: null,
  route: { name: 'home' },
  backStack: [],
  liked: new Set(),
  likedKeys: [],
  disliked: new Set(),
  playlists: [],
  likedPlaylists: [],
  libraryReady: false,
  toast: null,
  nowPlayingOpen: false,
  tuningOpen: false,
  searchQuery: '',
}));

const set = useApp.setState;
const get = useApp.getState;

setDislikedCheck((id) => get().disliked.has(id));

export function navigate(route: Route) {
  const s = get();
  if (JSON.stringify(s.route) === JSON.stringify(route)) return;
  set({ route, backStack: [...s.backStack.slice(-30), s.route], nowPlayingOpen: false });
}

export function back() {
  const s = get();
  const prev = s.backStack[s.backStack.length - 1];
  if (prev) set({ route: prev, backStack: s.backStack.slice(0, -1) });
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
    set({ account, auth: 'ready' });
    refreshLibrary();
  } catch (e) {
    toast(tr().toast.loginFailed(errorText(e)));
    set({ auth: 'login' });
  }
}

export async function loginWithToken(token: string) {
  await transport.setToken(token);
  await init();
}

export async function loginWithYandex() {
  if (!transport.login) return;
  if (await transport.login()) await init();
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
