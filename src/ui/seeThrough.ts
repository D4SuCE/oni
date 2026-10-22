// "Window transparency": how much of the Windows acrylic (the blurred desktop, like the
// taskbar's glass) shows through the app's own background art. 0 = solid, 0.8 = mostly glass.

import { create } from 'zustand';

const KEY = 'ui.seeThrough';
export const MAX_SEE_THROUGH = 0.8;

function initial() {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (localStorage.getItem(KEY) !== null && Number.isFinite(v)) return Math.min(MAX_SEE_THROUGH, Math.max(0, v));
  } catch {
    /* storage unavailable */
  }
  return 0.3;
}

export const useSeeThrough = create<{ value: number }>(() => ({ value: initial() }));

const apply = (v: number) => {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--see-through', String(v));
};
apply(useSeeThrough.getState().value);

export function setSeeThrough(value: number) {
  const v = Math.min(MAX_SEE_THROUGH, Math.max(0, value));
  useSeeThrough.setState({ value: v });
  apply(v);
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* storage unavailable */
  }
}

/**
 * "Cover haze": the blurred cover of the playing track tints the window in its colours (yellow,
 * violet, blue…), also through the transparency, which otherwise fades it with the rest of the
 * background (the user liked it in the test runs, where the transparency is at its default).
 */
const HAZE_KEY = 'ui.coverHaze';

function initialHaze() {
  try {
    return localStorage.getItem(HAZE_KEY) === '1';
  } catch {
    return false;
  }
}

export const useCoverHaze = create<{ enabled: boolean }>(() => ({ enabled: initialHaze() }));

const applyHaze = (on: boolean) => {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('haze', on);
};
applyHaze(useCoverHaze.getState().enabled);

export function setCoverHaze(enabled: boolean) {
  useCoverHaze.setState({ enabled });
  applyHaze(enabled);
  try {
    localStorage.setItem(HAZE_KEY, enabled ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}
