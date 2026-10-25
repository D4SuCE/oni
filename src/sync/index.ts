// The shared history in the app: connect Yandex Disk once (Settings), then this device's file
// goes up when something changed (every few minutes, and when Oni is hidden), and the other
// devices' files are read at start, every few minutes, and when Oni comes back. Without a network
// it all waits: what was heard here is never lost, it goes up later.

import { create } from 'zustand';
import { storage, transport } from '../api/client.ts';
import { useLang } from '../i18n.ts';
import { history, playLog, recentPlays, useRecent } from '../player/player.ts';
import { DeviceSync, type Device } from './devices.ts';
import { DiskAuthError, YandexDisk } from './disk.ts';
import { startElsewhere, stopElsewhere } from './elsewhere.ts';

const EVERY = 5 * 60_000;
/** After a round that failed (no network, Disk not answering), the next one this soon, not in five minutes. */
const RETRY = 30_000;
let retry: ReturnType<typeof setTimeout> | null = null;
/** Back in view: the others are read again if it has been this long. */
const REREAD = 60_000;

interface SyncState {
  /** Disk connected (null: not known yet, or this platform has none). */
  connected: boolean | null;
  busy: boolean;
  /** The last time both ways went through. */
  at: number | null;
  devices: { device: Device; at: number }[];
  /** The token was refused: connect again. */
  expired: boolean;
}

export const useSync = create<SyncState>(() => ({ connected: null, busy: false, at: null, devices: [], expired: false }));
const set = useSync.setState;

function deviceId() {
  let id = storage.getItem('sync.device');
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
    storage.setItem('sync.device', id);
  }
  return id;
}

export const disk = new YandexDisk(transport);
export const deviceSync = new DeviceSync(disk, { history, playLog, recent: recentPlays }, { id: deviceId(), platform: transport.platform });

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
let readAt = 0;

/** Both ways now: read the others, send this one if it changed. One at a time. */
export function syncNow(): Promise<void> {
  if (!useSync.getState().connected) return Promise.resolve();
  running ??= (async () => {
    set({ busy: true });
    try {
      await deviceSync.pull();
      readAt = Date.now();
      await deviceSync.push();
      set({ at: Date.now(), devices: deviceSync.devices(), expired: false });
      useRecent.setState((s) => ({ version: s.version + 1 }));
    } catch (e) {
      if (e instanceof DiskAuthError) {
        stop();
        set({ connected: false, expired: true });
      } else {
        console.warn('[sync]', e); // no network and the like: tried again soon
        if (!retry && !transport.testMode) retry = setTimeout(() => ((retry = null), void syncNow()), RETRY);
      }
    } finally {
      set({ busy: false });
      running = null;
    }
  })();
  return running;
}

/** Only sends (Oni hidden: there may be no next time soon). */
function sendSoon() {
  if (useSync.getState().connected) deviceSync.push().catch((e) => console.warn('[sync]', e));
}

function onVisibility() {
  if (document.visibilityState === 'hidden') sendSoon();
  else if (Date.now() - readAt > REREAD) syncNow();
}

function begin() {
  set({ connected: true, expired: false });
  // What plays on the other devices (and this one's, for them): its own looks, more often.
  startElsewhere(disk, deviceSync.device);
  // Automated tests sync when they say so: a test run's plays never go up by themselves.
  if (transport.testMode) return;
  timer ??= setInterval(syncNow, EVERY);
  document.addEventListener('visibilitychange', onVisibility);
  syncNow();
}

function stop() {
  stopElsewhere();
  if (timer) clearInterval(timer);
  timer = null;
  if (retry) clearTimeout(retry);
  retry = null;
  document.removeEventListener('visibilitychange', onVisibility);
}

/** At start, after sign-in. */
export async function startSync() {
  if (!transport.hasDiskToken) return;
  if (await transport.hasDiskToken()) begin();
  else set({ connected: false });
}

/** "Connect Yandex Disk": Yandex's page asks to allow Oni its folder. */
export async function connectDisk() {
  if (!transport.diskLogin || !(await transport.diskLogin(useLang.getState().lang))) return false;
  begin();
  return true;
}

/** Disconnected: the other devices' plays leave this one; the files stay on Disk. */
export async function disconnectDisk() {
  stop();
  await transport.setDiskToken?.(null);
  deviceSync.clear();
  set({ connected: false, at: null, devices: [], expired: false });
  useRecent.setState((s) => ({ version: s.version + 1 }));
}
