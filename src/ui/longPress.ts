// Touch: holding a finger on a track (or anything else with a menu) opens that menu, as a right
// click does on the desktop. iOS sends no contextmenu event for a long press, so one is sent
// here; the menus' own onContextMenu handlers do the rest.

/** How long to hold, and how far the finger may wander meanwhile (it is a scroll beyond that). */
const HOLD = 450;
const SLOP = 10;
/** After the finger lifts, its leftover mouse events must not close the menu or play the track. */
const AFTERMATH = 450;

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
      const target = e.target as Element;
      if (target.closest('input, textarea, .menu')) return;
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
          held = menu.defaultPrevented; // a handler opened a menu
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
    // A quick tap on the menu that just opened is meant for it.
    if (e.type !== 'touchmove' && (e.target as Element).closest?.('.menu')) return;
    e.stopImmediatePropagation();
    if (e.type !== 'touchmove') e.preventDefault();
  };
  for (const type of ['touchmove', 'mousedown', 'mouseup', 'click']) window.addEventListener(type, swallow, { capture: true, passive: false });
}
