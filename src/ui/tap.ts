// Touch: a tap on a button is a press, even when no click comes for it. iOS sends no click when
// something on screen changes under the finger as it taps (it takes the tap for a hover): a page's
// rows still coming in one after another (the cascade) did, and the bottom tabs went off only on the
// second quick tap (the user, 25.10.2026). A short tap that stayed in place and got no click is
// pressed here; a real click coming late after all is then not a second press.

import { pressRing } from './anim.ts';

/** How far the finger may wander (a scroll beyond that), and how long it may rest (a long press, longPress.ts). */
const SLOP = 10;
const HOLD = 450;
/** A tap's click comes at once: none by then, it is not coming. */
const WAIT = 350;
/** A click this late after the press made here is the same tap's. */
const LATE = 1000;

export function connectTapRescue() {
  let down: { id: number; x: number; y: number; t: number; button: HTMLButtonElement } | null = null;
  let pending: { button: HTMLButtonElement; timer: ReturnType<typeof setTimeout> } | null = null;
  let pressed: { button: HTMLButtonElement; until: number } | null = null;

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      const button = (e.target as Element | null)?.closest?.('button') as HTMLButtonElement | null;
      down = button ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, button } : null;
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > SLOP) down = null;
    },
    true,
  );
  window.addEventListener('pointercancel', () => (down = null), true);
  window.addEventListener(
    'pointerup',
    (e) => {
      const d = down;
      down = null;
      if (!d || e.pointerId !== d.id || e.timeStamp - d.t > HOLD || Math.hypot(e.clientX - d.x, e.clientY - d.y) > SLOP) return;
      if (pending) clearTimeout(pending.timer);
      const { button } = d;
      const { clientX: x, clientY: y } = e;
      pending = {
        button,
        timer: setTimeout(() => {
          pending = null;
          if (!button.isConnected || button.disabled) return;
          pressed = { button, until: performance.now() + LATE };
          pressRing(x, y, button);
          button.click();
        }, WAIT),
      };
    },
    true,
  );
  window.addEventListener(
    'click',
    (e) => {
      const target = e.target as Node;
      if (pending?.button.contains(target)) {
        clearTimeout(pending.timer);
        pending = null;
      } else if (e.detail > 0 && pressed && performance.now() < pressed.until && pressed.button.contains(target)) {
        // The tap's own click, late: pressed already.
        e.stopImmediatePropagation();
        e.preventDefault();
        pressed = null;
      }
    },
    true,
  );
}
