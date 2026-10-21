// Touch: drag a full-screen sheet down to close it, as Now Playing closes in music apps.

import { useEffect, type RefObject } from 'react';

/** Far enough down, or a quick flick, closes; anything less springs back. */
const CLOSE_AT = 120;
const FLICK = 0.6; // px per ms

/** `handle`: where the drag may start, when the sheet itself scrolls (the wave's Tune panel). */
export function useSwipeDown(ref: RefObject<HTMLElement | null>, onClose: () => void, handle?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    const grip = handle?.current ?? el;
    if (!el || !grip) return;
    let start: { id: number; y: number; t: number } | null = null;
    let dy = 0;
    const settle = (close: boolean) => {
      el.style.transition = 'transform 0.22s ease';
      el.style.transform = close ? 'translateY(100%)' : '';
      if (close) setTimeout(onClose, 200);
    };
    const down = (e: PointerEvent) => {
      // Sliders keep their drag; the queue and lyrics column (wide screens) scrolls on its own.
      if (e.pointerType !== 'touch' || (e.target as Element).closest('input, .np-side')) return;
      start = { id: e.pointerId, y: e.clientY, t: e.timeStamp };
      dy = 0;
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      dy = Math.max(0, e.clientY - start.y);
      el.style.transition = 'none';
      el.style.transform = dy ? `translateY(${dy}px)` : '';
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const fast = dy / Math.max(1, e.timeStamp - start.t) > FLICK;
      start = null;
      settle(e.type === 'pointerup' && (dy > CLOSE_AT || (fast && dy > 40)));
    };
    grip.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      grip.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [ref, onClose, handle]);
}
