// Auto-update state from the desktop shell (electron/updater.cjs): Settings shows it,
// the sidebar marks Settings once a new version is downloaded.

import { create } from 'zustand';
import type { UpdateState } from '../api/transport.ts';
import { tr } from '../i18n.ts';
import { useApp } from '../store.ts';

export const useUpdate = create<UpdateState>(() => window.wave?.updateState?.() ?? { status: 'off' });

window.wave?.onUpdate?.((next) => {
  const wasReady = useUpdate.getState().status === 'ready';
  useUpdate.setState(next, true);
  if (next.status === 'ready' && !wasReady && next.version) useApp.setState({ toast: { id: Date.now(), text: tr().update.readyToast(next.version) } });
});
