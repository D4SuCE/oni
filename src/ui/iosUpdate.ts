// The iPhone's updates. Oni cannot install itself (only SideStore can, with the user's Apple ID
// and LocalDevVPN on), but it can do the rest as on Windows: it reads the SideStore source,
// learns of a new version as soon as its IPA is published, says so, and "Update" opens SideStore
// with that very file (sidestore://install?url=…), so there is nothing to look for and no wait.

import { create } from 'zustand';
import { loadJson, storage, transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { useApp } from '../store.ts';
import { useUpdate } from './update.ts';
import { isNewer } from './version.ts';

const SOURCE = 'https://raw.githubusercontent.com/D4SuCE/oni-releases/main/sidestore.json';
const EVERY = 6 * 3600_000;

/** Auto-update (Settings, off by default): a new version opens SideStore by itself, once per
 * version, while Oni is on screen. The user's Shortcuts automations turn LocalDevVPN on when
 * SideStore opens and off when it closes; Oni cannot set those up itself (iOS lets no app create
 * automations, nor share them). */
const AUTO_KEY = 'update.auto';
export const useAutoUpdate = create<{ on: boolean; opened: string; shortcut: boolean }>(() => ({
  shortcut: false,
  ...loadJson(AUTO_KEY, { on: false, opened: '' }),
}));
const saveAuto = () => storage.setItem(AUTO_KEY, JSON.stringify(useAutoUpdate.getState()));
export function setAutoUpdate(on: boolean) {
  useAutoUpdate.setState({ on });
  saveAuto();
  if (on) checkIosUpdate();
}

/** The Shortcuts shortcut that wraps SideStore with LocalDevVPN: on, open SideStore with the link
 * it is given, wait, off (the user's own, 22.10.2026). Run by name with the SideStore link as input. */
export const UPDATE_SHORTCUT = 'Oni - Update';
/** Where Shortcuts adds it from (shared by the user). Capacitor opens other sites outside the app. */
export const UPDATE_SHORTCUT_LINK = 'https://www.icloud.com/shortcuts/3c691508574444aeba0005d0801d28e8';
export function installUpdateShortcut() {
  location.href = UPDATE_SHORTCUT_LINK;
}
/** Switched on, it offers the shortcut right away (Shortcuts asks before adding it). */
export function setUpdateViaShortcut(shortcut: boolean) {
  useAutoUpdate.setState({ shortcut });
  saveAuto();
  if (shortcut) installUpdateShortcut();
}

let checkedAt = 0;

export async function checkIosUpdate() {
  checkedAt = Date.now();
  const was = useUpdate.getState();
  if (was.status !== 'ready') useUpdate.setState({ status: 'checking' }, true);
  try {
    const r = await transport.request<{ apps?: { versions?: { version: string; downloadURL: string }[] }[] }>({ url: `${SOURCE}?t=${Date.now()}` });
    const latest = r.data?.apps?.[0]?.versions?.[0];
    if (!r.ok || !latest) throw new Error(`HTTP ${r.status}`);
    if (isNewer(latest.version, __APP_VERSION__)) {
      useUpdate.setState({ status: 'ready', version: latest.version, url: latest.downloadURL }, true);
      const auto = useAutoUpdate.getState();
      if (auto.on && auto.opened !== latest.version && !document.hidden) {
        useAutoUpdate.setState({ opened: latest.version });
        storage.setItem(AUTO_KEY, JSON.stringify(useAutoUpdate.getState()));
        installIosUpdate();
      } else if (was.version !== latest.version) useApp.setState({ toast: { id: Date.now(), text: tr().update.iosToast(latest.version) } });
    } else useUpdate.setState({ status: 'latest' }, true);
  } catch (e) {
    if (was.status !== 'ready') useUpdate.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }, true);
  }
}

/** "Update": SideStore takes the file and installs it over this version (data stays). */
export function installIosUpdate() {
  const url = useUpdate.getState().url;
  if (!url) return;
  const sidestore = `sidestore://install?url=${encodeURIComponent(url)}`;
  location.href = useAutoUpdate.getState().shortcut
    ? `shortcuts://run-shortcut?name=${encodeURIComponent(UPDATE_SHORTCUT)}&input=text&text=${encodeURIComponent(sidestore)}`
    : sidestore;
}

/** At start, every few hours, and on return to the app if it has been a while. */
export function watchIosUpdates() {
  checkIosUpdate();
  setInterval(checkIosUpdate, EVERY);
  document.addEventListener('visibilitychange', () => !document.hidden && Date.now() - checkedAt > 3600_000 && checkIosUpdate());
}
