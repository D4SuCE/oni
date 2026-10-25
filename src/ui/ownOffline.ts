// "Keep mine offline" (the user's pick of features to be used, 24.10.2026): On Repeat and the latest
// likes download by themselves, so what one listens to is there with no network. On the iPhone over
// Wi-Fi only (not mobile data, a hotspot, or Low Data Mode), its own switch in Settings, on by default;
// on the desktop it comes with "Download new likes". The room for downloads (Settings → Downloads)
// still rules: what was played longest ago goes first. Looked at now and then, not on every opening.

import { create } from 'zustand';
import { api, storage, transport } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { offline } from '../player/player.ts';
import { useRecs } from '../recs/index.ts';
import { useApp } from '../store.ts';
import { background, useAutoLikes } from './offline.ts';
import { isIos } from './platform.ts';

const KEY = 'downloads.autoOwn';
const AT_KEY = 'downloads.autoOwn.at';
/** Looked at this often at most (a new On Repeat comes with the mixes, new likes all day). */
const EVERY = 6 * 60 * 60 * 1000;
/** The latest likes kept (Liked's own Download is for all of them). */
export const LATEST_LIKES = 30;

function readOn(): boolean {
  try {
    const raw = storage.getItem(KEY);
    return raw === null ? true : JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

export const useAutoOwn = create<{ on: boolean }>(() => ({ on: readOn() }));

export function setAutoOwn(on: boolean) {
  useAutoOwn.setState({ on });
  storage.setItem(KEY, JSON.stringify(on));
  if (on) void keepOwnOffline(true);
}

const enabled = () => (isIos ? useAutoOwn.getState().on : useAutoLikes.getState().on);

/** Wi-Fi (or a cable): not mobile data, a hotspot or Low Data Mode. The desktop: always. */
async function cheapNetwork() {
  if (!isIos) return true;
  try {
    const { OniDownloads } = await import('../player/iosDownloads.ts');
    const n = await OniDownloads.network();
    return n.satisfied && !n.expensive && !n.constrained;
  } catch {
    return false;
  }
}

let running = false;

/** What is to be kept and is not downloaded yet: On Repeat, then the latest likes (each once). */
export async function ownToKeep(): Promise<Track[]> {
  if (!offline) return [];
  const repeat = useRecs.getState().mixes.find((m) => m.kind === 'repeat')?.tracks ?? [];
  const latest = useApp.getState().likedKeys.slice(0, LATEST_LIKES).map((k) => k.split(':')[0]).filter((id) => !offline!.has(id));
  const liked = latest.length ? await api.tracks(latest) : [];
  const want = new Map<string, Track>();
  for (const t of [...repeat, ...liked]) if (t.available !== false && !offline.has(String(t.id))) want.set(String(t.id), t);
  return [...want.values()];
}

/** On Repeat and the latest likes not downloaded yet, downloaded; `now`: whenever it was done last. */
export async function keepOwnOffline(now = false) {
  const app = useApp.getState();
  // A test run downloads only when it says so (`now`), not by itself.
  if (!offline || running || !enabled() || app.offline || !app.libraryReady || (transport.testMode && !now)) return;
  if (useRecs.getState().status !== 'ready') return;
  if (!now && Date.now() - Number(storage.getItem(AT_KEY) || 0) < EVERY) return;
  if (!(await cheapNetwork())) return;
  running = true;
  try {
    storage.setItem(AT_KEY, String(Date.now()));
    const tracks = await ownToKeep();
    if (!tracks.length) return;
    // The iPhone: through iOS, as a list (its ring in the shade); the desktop: one after another, quietly.
    if (background) await background.add('own-offline', tracks, '');
    else for (const t of tracks) await offline.download(t).catch((e) => console.warn('[own offline]', t.id, e));
  } catch (e) {
    console.warn('[own offline]', e); // no network and the like: the next time
  } finally {
    running = false;
  }
}

/** When the mixes are made (On Repeat with them), and when Oni comes back to the screen. */
export function watchOwnOffline() {
  useRecs.subscribe((s, was) => s.status === 'ready' && was.status !== 'ready' && void keepOwnOffline());
  useApp.subscribe((s, was) => s.libraryReady && !was.libraryReady && void keepOwnOffline());
  document.addEventListener('visibilitychange', () => !document.hidden && void keepOwnOffline());
}
