// Japanese-style animations (the user's wish, 23.10.2026; tried on Windows before any release):
// fusuma (pages slide in like a sliding paper door), scroll (Now Playing and the sheets unroll like a
// hand scroll), hanko (a like is stamped like a red seal), petals (sakura petals fall from a like or
// an add to a playlist), ink (covers and the banner bleed in like sumi ink), cascade (cards and rows
// come in one after another), hamon (a ring spreads from where a button was pressed, as on water;
// the user: "sometimes it is not clear whether a button was pressed"). Each has its own switch in Settings; all of them go with the system's
// reduced motion, and the e2e runs start with them off (their own step turns them on). Short and
// one-off only: nothing runs on its own in the background (the iPhone heats up).

import { create } from 'zustand';
import { transport } from '../api/client.ts';
import { haptic } from './haptics.ts';

export const ANIM_EFFECTS = ['fusuma', 'scroll', 'hanko', 'petals', 'ink', 'cascade', 'hamon'] as const;
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

// Where the last press was: a like or an add to a playlist starts its stamp and petals there (the
// press's button), whatever called it.
let lastPress: { x: number; y: number; button: HTMLElement | null; at: number } | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      const button = (e.target as Element | null)?.closest?.('button') as HTMLElement | null;
      lastPress = { x: e.clientX, y: e.clientY, button, at: Date.now() };
      if (button && !(button as HTMLButtonElement).disabled) hamon(e.clientX, e.clientY, button);
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
const recentPress = () => (lastPress && Date.now() - lastPress.at < 4000 ? lastPress : null);

/** A track liked: its heart is stamped like a hanko, and petals fall from it. */
export function celebrateLike() {
  const press = recentPress();
  if (!press) return;
  if (animOn('hanko') && press.button?.isConnected) {
    const b = press.button;
    b.classList.remove('hanko');
    void b.offsetWidth; // restart the animation on a second like
    b.classList.add('hanko');
    b.addEventListener('animationend', () => b.classList.remove('hanko'), { once: true });
  }
  petals(press.x, press.y);
}

/** A track added to a playlist: petals from where it was picked. */
export function celebrateAdd() {
  const press = recentPress();
  if (press) petals(press.x, press.y, 7);
}

/** A few sakura petals that drift down from (x, y) and are gone in under two seconds. */
export function petals(x: number, y: number, count = 6) {
  if (!animOn('petals') || typeof document === 'undefined') return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'sakura-petal';
    const dx = (Math.random() - 0.5) * 140;
    const dy = 70 + Math.random() * 110;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--dx', `${dx.toFixed(0)}px`);
    p.style.setProperty('--dy', `${dy.toFixed(0)}px`);
    p.style.setProperty('--rot', `${((Math.random() - 0.5) * 540).toFixed(0)}deg`);
    p.style.setProperty('--s', (0.7 + Math.random() * 0.6).toFixed(2));
    p.style.animationDelay = `${(i * 45).toFixed(0)}ms`;
    p.addEventListener('animationend', () => p.remove(), { once: true });
    document.body.appendChild(p);
  }
}
