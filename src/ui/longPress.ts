// Touch: holding a finger on a track (or anything else with a menu) opens that menu, as a right
// click does on the desktop. iOS sends no contextmenu event for a long press, so one is sent
// here; the menus' own onContextMenu handlers do the rest. A button with only an icon and no
// menu says instead what it does, in a small hint above it (the desktop's tooltip; the user:
// "clearer, but don't pile it up"), and does not go off.

import { haptic } from './haptics.ts';

/** How long to hold, and how far the finger may wander meanwhile (it is a scroll beyond that). */
const HOLD = 450;
const SLOP = 10;
/** After the finger lifts, its leftover mouse events must not close the menu, play the track or
 * pick a menu item (the sheet may lie under the finger): they are swallowed until the next touch
 * starts, or this long at most. */
const AFTERMATH = 1000;

/** How long the hint stays after the finger lifts. */
const HINT_FOR = 1500;
let hint: { el: HTMLElement; timer?: ReturnType<typeof setTimeout> } | null = null;

/** The words shown on a button; empty when it shows only its sign (the iPhone hides the words of
 * round buttons: font size 0, or the label not displayed). */
function shownWords(button: Element) {
  if (!(button instanceof HTMLElement) || parseFloat(getComputedStyle(button).fontSize) === 0) return '';
  return button.innerText.trim();
}

/** What a button that shows only its sign does: its tooltip, else the words it hides (the user,
 * 25.10.2026: "many buttons show nothing, one has to guess" — Shuffle in Liked on the iPhone).
 * Null for a button with words on it. */
function buttonHint(target: Element): { button: Element; text: string } | null {
  const button = target.closest('button, [role="button"]');
  if (!button || button.closest('.menu') || shownWords(button)) return null;
  const text = (button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim();
  return text ? { button, text } : null;
}

/** The desktop's tooltip for a button that shows only its sign and has none of its own (a narrow
 * window, the menu folded): the words it hides, given when the mouse comes over it. */
export function connectButtonNames() {
  window.addEventListener(
    'pointerover',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const button = (e.target as Element | null)?.closest?.('button, [role="button"]');
      if (!button || button.hasAttribute('title') || button.hasAttribute('aria-label') || shownWords(button)) return;
      const words = button.textContent?.trim();
      if (words) button.setAttribute('title', words);
    },
    true,
  );
}

function showHint(target: Element) {
  const found = buttonHint(target);
  if (!found) return false;
  if (hint) {
    clearTimeout(hint.timer);
    hint.el.remove();
  }
  const el = Object.assign(document.createElement('div'), { className: 'hold-hint', textContent: found.text });
  el.setAttribute('role', 'tooltip');
  document.body.append(el);
  const r = found.button.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  // Above the finger, or below the button when there is no room (the top bar).
  const above = r.top - el.offsetHeight - 10;
  el.style.left = `${left}px`;
  el.style.top = `${above > 8 ? above : r.bottom + 10}px`;
  const shown: NonNullable<typeof hint> = { el };
  const hide = () => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 200);
    if (hint === shown) hint = null;
  };
  // Gone a while after the finger lifts.
  window.addEventListener('pointerup', () => (shown.timer = setTimeout(hide, HINT_FOR)), { once: true, capture: true });
  hint = shown;
  return true;
}

export function connectLongPress() {
  let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let held = false;
  let swallowUntil = 0;
  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch' || !e.isPrimary) return;
      swallowUntil = 0; // a new touch: what follows is its own
      const target = e.target as Element;
      // A list being put in order (the iPhone's "Move"): a hold there is for dragging (on a handle
      // the menu opened, the drag stopped).
      if (target.closest('input, textarea, .menu, .drag-handle, .reordering')) return;
      cancel();
      const { clientX: x, clientY: y } = e;
      press = {
        id: e.pointerId,
        x,
        y,
        timer: setTimeout(() => {
          press = null;
          const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
          target.dispatchEvent(menu);
          held = menu.defaultPrevented || showHint(target); // a handler opened a menu, or a hint shows
          if (held) haptic('pick');
        }, HOLD),
      };
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancel();
    },
    true,
  );
  const lift = () => {
    cancel();
    if (held) swallowUntil = performance.now() + AFTERMATH;
    held = false;
  };
  window.addEventListener('pointerup', lift, true);
  window.addEventListener('pointercancel', lift, true);

  // While the finger still rests after the menu opened, its small moves are not a scroll that
  // should close the menu; once lifted, the tap's mouse events belong to the hold, not the row.
  const swallow = (e: Event) => {
    const now = held || performance.now() < swallowUntil;
    if (!now || (e.type === 'touchmove' && !held)) return;
    e.stopImmediatePropagation();
    if (e.type !== 'touchmove') e.preventDefault();
  };
  for (const type of ['touchmove', 'mousedown', 'mouseup', 'click']) window.addEventListener(type, swallow, { capture: true, passive: false });
}
