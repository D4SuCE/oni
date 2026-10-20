// "Live covers": Yandex's looping cover videos, slow movement of still covers and of
// the backdrop. Off by default when the system asks for reduced motion.

import { create } from 'zustand';

const KEY = 'ui.motion';

function initial() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* storage unavailable */
  }
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export const useMotion = create<{ enabled: boolean }>(() => ({ enabled: initial() }));

const apply = (on: boolean) => {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('motion', on);
};
apply(useMotion.getState().enabled);

export function setMotion(enabled: boolean) {
  useMotion.setState({ enabled });
  apply(enabled);
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

// Beat pulse: covers and the hero mask throb on the bass. Same default as live covers.
const PULSE_KEY = 'ui.pulse';

function initialPulse() {
  try {
    const v = localStorage.getItem(PULSE_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch {
    /* storage unavailable */
  }
  return useMotion.getState().enabled;
}

export const usePulse = create<{ enabled: boolean }>(() => ({ enabled: initialPulse() }));

export function setPulse(enabled: boolean) {
  usePulse.setState({ enabled });
  try {
    localStorage.setItem(PULSE_KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}
