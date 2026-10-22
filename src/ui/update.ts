// Auto-update state from the desktop shell (electron/updater.cjs): Settings shows it,
// the sidebar marks Settings once a new version is downloaded.

import { create } from 'zustand';
import type { UpdateState } from '../api/transport.ts';
import { tr } from '../i18n.ts';
import { toast } from '../store.ts';

export const useUpdate = create<UpdateState>(() => window.wave?.updateState?.() ?? { status: 'off' });

// Downloaded before the page was up (the check runs right at start): said at once, too.
const initial = useUpdate.getState();
if (initial.status === 'ready' && initial.version) setTimeout(() => toast(tr().update.readyToast(initial.version!)), 1500);

// The window opened again (from the tray, restored) after a while: look for a new version.
let shownAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden || Date.now() - shownAt < 10 * 60_000) return;
  shownAt = Date.now();
  window.wave?.checkUpdate?.();
});

window.wave?.onUpdate?.((next) => {
  const wasReady = useUpdate.getState().status === 'ready';
  useUpdate.setState(next, true);
  if (next.status === 'ready' && !wasReady && next.version) toast(tr().update.readyToast(next.version)); // timed, as every toast
});
