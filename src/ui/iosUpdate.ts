// The iPhone's updates. Oni cannot install itself (only SideStore can, with the user's Apple ID
// and LocalDevVPN on), but it can do the rest as on Windows: it reads the SideStore source,
// learns of a new version as soon as its IPA is published, says so, and "Update" opens SideStore
// with that very file (sidestore://install?url=…), so there is nothing to look for and no wait.

import { transport } from '../api/client.ts';
import { tr } from '../i18n.ts';
import { useApp } from '../store.ts';
import { useUpdate } from './update.ts';
import { isNewer } from './version.ts';

const SOURCE = 'https://raw.githubusercontent.com/D4SuCE/oni-releases/main/sidestore.json';
const EVERY = 6 * 3600_000;

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
      if (was.version !== latest.version) useApp.setState({ toast: { id: Date.now(), text: tr().update.iosToast(latest.version) } });
    } else useUpdate.setState({ status: 'latest' }, true);
  } catch (e) {
    if (was.status !== 'ready') useUpdate.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }, true);
  }
}

/** "Update": SideStore takes the file and installs it over this version (data stays). */
export function installIosUpdate() {
  const url = useUpdate.getState().url;
  if (url) location.href = `sidestore://install?url=${encodeURIComponent(url)}`;
}

/** At start, every few hours, and on return to the app if it has been a while. */
export function watchIosUpdates() {
  checkIosUpdate();
  setInterval(checkIosUpdate, EVERY);
  document.addEventListener('visibilitychange', () => !document.hidden && Date.now() - checkedAt > 3600_000 && checkIosUpdate());
}
