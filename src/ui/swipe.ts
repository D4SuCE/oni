// Touch: drag a full-screen sheet down to close it, as Now Playing closes in music apps.

import { useEffect, useState, type RefObject } from 'react';
import { haptic } from './haptics.ts';

/** Where a drag is something else's: sliders, rows dragged into order (a handle, a list in
 * "Reorder"), the queue's sheet over Now Playing (its own scroll and handles). Dragging a track
 * down there pulled the whole screen down instead (the user on 1.6.1). */
const NOT_A_SWIPE = 'input, .drag-handle, .reordering, .q-sheet';

/** Far enough down, or a quick flick, closes; anything less springs back. */
const CLOSE_AT = 120;
const FLICK = 0.6; // px per ms

/** `handle`: where the drag may start, when the sheet itself scrolls (the wave's Tune panel). */
export function useSwipeDown(ref: RefObject<HTMLElement | null>, onClose: () => void, handle?: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    const grip = handle?.current ?? el;
    if (!el || !grip || !enabled) return;
    let start: { id: number; y: number; t: number } | null = null;
    let dy = 0;
    const settle = (close: boolean) => {
      el.style.transition = 'transform 0.22s ease';
      el.style.transform = close ? 'translateY(100%)' : '';
      if (close) setTimeout(onClose, 200);
    };
    const down = (e: PointerEvent) => {
      // Sliders and dragged rows keep their drag; the queue and lyrics column (wide screens) scrolls on its own.
      if (e.pointerType !== 'touch' || (e.target as Element).closest(`${NOT_A_SWIPE}, .np-side`)) return;
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
  }, [ref, onClose, handle, enabled]);
}

/**
 * A page that scrolls (a playlist, an album) goes back with a pull down from its very top, as
 * sheets close (the user asked for it on the iPhone). Touch events, not pointer ones: iOS cancels
 * a pointer as soon as it scrolls or bounces, and a pull from the top is one. Higher up the page
 * scrolls as ever; once a pull starts, the page follows the finger instead of bouncing.
 */
export function useSwipeBack(scroller: RefObject<HTMLElement | null>, page: () => HTMLElement | null, onBack: () => void, enabled: boolean) {
  useEffect(() => {
    const box = scroller.current;
    if (!box || !enabled) return;
    let start: { y: number; x: number; t: number } | null = null;
    let pulling = false;
    let dy = 0;
    const move = (y: number) => {
      const el = page();
      if (!el) return;
      el.style.transition = y ? 'none' : 'transform 0.22s ease';
      el.style.transform = y ? `translateY(${y}px)` : '';
    };
    const down = (e: TouchEvent) => {
      const touch = e.touches[0];
      // One finger, from the top, not on a slider or a track being dragged into order.
      start = e.touches.length === 1 && box.scrollTop <= 0 && !(e.target as Element).closest(NOT_A_SWIPE) ? { y: touch.clientY, x: touch.clientX, t: e.timeStamp } : null;
      pulling = false;
      dy = 0;
    };
    const drag = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.touches[0];
      const d = touch.clientY - start.y;
      if (!pulling) {
        // Up or sideways first: an ordinary scroll (or a slider), not a pull.
        if (d < 0 || Math.abs(touch.clientX - start.x) > Math.abs(d)) return void (start = null);
        if (d < 8) return;
        pulling = true;
      }
      e.preventDefault();
      dy = Math.max(0, d);
      move(dy);
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const fast = dy / Math.max(1, e.timeStamp - start.t) > FLICK;
      const back = pulling && e.type === 'touchend' && (dy > CLOSE_AT || (fast && dy > 40));
      start = null;
      pulling = false;
      if (!back) return move(0);
      const el = page();
      if (el) {
        el.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
        el.style.transform = 'translateY(40%)';
        el.style.opacity = '0';
      }
      setTimeout(onBack, 180);
    };
    box.addEventListener('touchstart', down, { passive: true });
    box.addEventListener('touchmove', drag, { passive: false });
    box.addEventListener('touchend', up);
    box.addEventListener('touchcancel', up);
    return () => {
      box.removeEventListener('touchstart', down);
      box.removeEventListener('touchmove', drag);
      box.removeEventListener('touchend', up);
      box.removeEventListener('touchcancel', up);
    };
  }, [scroller, page, onBack, enabled]);
}

/**
 * Seek by a sideways swipe along a strip — the iPhone's player bar, as in Yandex Music's app (the
 * user, 26.10.2026). The strip's width is the whole track and the time moves from where it was;
 * letting go jumps there. Returns the time the finger points at while it swipes (null otherwise).
 * A tap stays a tap (the bar opens Now Playing, its buttons work); after a swipe the click that
 * follows is swallowed, so a swipe that starts on a button does not press it.
 */
export function useSwipeSeek(ref: RefObject<HTMLElement | null>, now: () => { position: number; duration: number }, onSeek: (seconds: number) => void, enabled = true) {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; from: number; duration: number } | null = null;
    let seeking = false;
    let to = 0;
    const down = (e: TouchEvent) => {
      const { position, duration } = now();
      const touch = e.touches[0];
      start = e.touches.length === 1 && duration > 0 && !(e.target as Element).closest(NOT_A_SWIPE) ? { x: touch.clientX, y: touch.clientY, from: position, duration } : null;
      seeking = false;
    };
    const drag = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!seeking) {
        // Up or down first: not a seek (the page scrolls, Now Playing opens).
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (start = null);
        if (Math.abs(dx) < 12) return;
        seeking = true;
        haptic('tick');
      }
      e.preventDefault();
      to = Math.max(0, Math.min(start.duration - 1, start.from + (dx / el.clientWidth) * start.duration));
      setAt(to);
    };
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      start = null;
      if (!seeking) return;
      seeking = false;
      setAt(null);
      if (e.type !== 'touchend') return;
      onSeek(to);
      el.addEventListener('click', swallow, { capture: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 400);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', drag, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', drag);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [ref, now, onSeek, enabled]);
  return at;
}
