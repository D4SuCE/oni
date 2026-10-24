// Japanese-style animations (the user's wish, 23.10.2026; picked after a trial build on Windows,
// 24.10.2026): fusuma (pages slide in like a sliding paper door), scroll (Now Playing and the
// sheets unroll like a hand scroll), cascade (cards and rows come in one after another), hamon (a
// ring spreads from where a button was pressed, as on water; the user: "sometimes it is not clear
// whether a button was pressed"). Petals, the hanko stamp and ink were tried and left out (petals
// off-key; the stamp and the ink hardly seen). Each has its own switch in Settings; all of them go
// with the system's reduced motion, and the e2e runs start with them off (their own step turns them
// on). Short and one-off only: nothing runs on its own in the background (the iPhone heats up).

import { create } from 'zustand';
import { transport } from '../api/client.ts';
import { haptic } from './haptics.ts';

export const ANIM_EFFECTS = ['fusuma', 'scroll', 'cascade', 'hamon'] as const;
export type AnimEffect = (typeof ANIM_EFFECTS)[number];

interface AnimState {
  enabled: boolean;
  effects: Record<AnimEffect, boolean>;
}

const KEY = 'ui.anim';
const allOn = Object.fromEntries(ANIM_EFFECTS.map((e) => [e, true])) as Record<AnimEffect, boolean>;

function initial(): AnimState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) return { enabled: Boolean(saved.enabled), effects: { ...allOn, ...saved.effects } };
  } catch {
    /* storage unavailable */
  }
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return { enabled: !reduced && !transport.testMode, effects: allOn };
}

export const useAnim = create<AnimState>(initial);

/** The effects on, as classes on the page's root (html.anim-fusuma …): the styles do the rest. */
function apply() {
  if (typeof document === 'undefined') return;
  const { enabled, effects } = useAnim.getState();
  for (const e of ANIM_EFFECTS) document.documentElement.classList.toggle(`anim-${e}`, enabled && effects[e]);
}
apply();

function save() {
  apply();
  try {
    localStorage.setItem(KEY, JSON.stringify(useAnim.getState()));
  } catch {
    /* storage unavailable */
  }
}

export function setAnimEnabled(enabled: boolean) {
  useAnim.setState({ enabled });
  save();
}

export function setAnimEffect(effect: AnimEffect, on: boolean) {
  useAnim.setState((s) => ({ effects: { ...s.effects, [effect]: on } }));
  save();
}

export const animOn = (effect: AnimEffect) => {
  const s = useAnim.getState();
  return s.enabled && s.effects[effect];
};

// A press of a button: its ring.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      const button = (e.target as Element | null)?.closest?.('button') as HTMLButtonElement | null;
      if (button && !button.disabled) hamon(e.clientX, e.clientY, button);
    },
    true,
  );
}

/** A thin ring spreads from the press and is gone in a third of a second: gold over dark buttons,
 * light over red ones. On the iPhone a light tap goes with it. */
function hamon(x: number, y: number, button: HTMLElement) {
  if (!animOn('hamon')) return;
  const ring = document.createElement('i');
  const bg = getComputedStyle(button).backgroundColor;
  const red = /rgba?\((\d+), (\d+), (\d+)/.exec(bg);
  ring.className = red && Number(red[1]) > 150 && Number(red[2]) < 90 ? 'hamon-ring light' : 'hamon-ring';
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  ring.addEventListener('animationend', () => ring.remove(), { once: true });
  document.body.appendChild(ring);
  haptic('tick');
}
