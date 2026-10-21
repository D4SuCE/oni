// Touch: sliders follow the finger from wherever it lands on the track, as iOS's own sliders do
// (a web range input only moves when its thumb is grabbed). The value is set and an input event
// sent, so React's onChange runs as for a drag; lifting the finger ends it as usual.

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

/** A slider turned upright (the equalizer's bands) grows upward. */
function setFromPoint(el: HTMLInputElement, x: number, y: number) {
  const box = el.getBoundingClientRect();
  const upright = box.height > box.width;
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const step = Number(el.step) || 1;
  const ratio = Math.max(0, Math.min(1, upright ? (box.bottom - y) / box.height : (x - box.left) / box.width));
  const value = Math.round((min + ratio * (max - min)) / step) * step;
  if (String(value) === el.value) return;
  valueSetter.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function connectTouchRanges() {
  let active: { el: HTMLInputElement; id: number } | null = null;
  const range = (t: EventTarget | null) => (t instanceof HTMLInputElement && t.type === 'range' && !t.disabled ? t : null);
  // The native slider would take the touch and move only from its thumb: it gets none.
  window.addEventListener('touchstart', (e) => range(e.target) && e.preventDefault(), { capture: true, passive: false });
  window.addEventListener(
    'pointerdown',
    (e) => {
      const el = range(e.target);
      if (e.pointerType !== 'touch' || !el) return;
      active = { el, id: e.pointerId };
      setFromPoint(el, e.clientX, e.clientY);
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (active && e.pointerId === active.id) setFromPoint(active.el, e.clientX, e.clientY);
    },
    true,
  );
  const end = (e: PointerEvent) => {
    if (active && e.pointerId === active.id) active = null;
  };
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
}
