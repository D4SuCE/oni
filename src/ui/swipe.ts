// Touch: drag a full-screen sheet down to close it, as Now Playing closes in music apps.

import { useEffect, type RefObject } from 'react';
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

/** Between a card and the next in a carousel (the player bar's neighbours). */
const CARD_GAP = 8;

/**
 * A sideways swipe along a card turns the track — the iPhone's player bar, a carousel of cards as
 * in Yandex Music's app (the user, 26.10.2026, with a video of it: the whole card follows the
 * finger, the next track's card comes in beside it, a gap between; let go, the new card settles and
 * its buttons appear). Left: the next; right: the previous. `peers()` gives the neighbours' cards
 * (`data-side` "prev" or "next"), placed beside the card when a swipe starts. Far enough (a quarter
 * of the card) or a quick flick turns, anything less springs back. A tap stays a tap (the bar opens
 * Now Playing, its buttons work); after a swipe the click that follows is swallowed.
 */
export function useSwipeTrack(ref: RefObject<HTMLElement | null>, peers: () => HTMLElement[], turn: (dir: 'next' | 'prev') => boolean, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; t: number } | null = null;
    let swiping = false;
    let dx = 0;
    const has = (side: 'next' | 'prev') => peers().some((p) => p.dataset.side === side);
    const place = (x: number, ms: number) => {
      for (const c of [el, ...peers()]) {
        c.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.25, 0.8, 0.3, 1)` : 'none';
        c.style.transform = x ? `translateX(${x}px)` : '';
      }
    };
    // the neighbours where the card is, one card and a gap to each side
    const lay = () => {
      const box = el.getBoundingClientRect();
      for (const p of peers()) {
        const side = p.dataset.side === 'prev' ? -1 : 1;
        Object.assign(p.style, { left: `${box.left + side * (box.width + CARD_GAP)}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, visibility: 'visible' });
      }
    };
    const hide = () => {
      for (const p of peers()) p.style.visibility = 'hidden';
    };
    const down = (e: TouchEvent) => {
      const touch = e.touches[0];
      start = e.touches.length === 1 && !(e.target as Element).closest(NOT_A_SWIPE) ? { x: touch.clientX, y: touch.clientY, t: e.timeStamp } : null;
      swiping = false;
      dx = 0;
    };
    const drag = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.touches[0];
      dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (!swiping) {
        // Up or down first: not a swipe (the page scrolls, Now Playing opens).
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (start = null);
        if (Math.abs(dx) < 12) return;
        swiping = true;
        lay();
      }
      e.preventDefault();
      // no card that way (the first track, nothing next yet): it follows, but reluctantly
      place(has(dx < 0 ? 'next' : 'prev') ? dx : dx / 3, 0);
    };
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const settle = () => {
      place(0, 220);
      setTimeout(hide, 230);
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const fast = Math.abs(dx) / Math.max(1, e.timeStamp - start.t) > FLICK;
      start = null;
      if (!swiping) return;
      swiping = false;
      el.addEventListener('click', swallow, { capture: true });
      setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 400);
      const dir = dx < 0 ? 'next' : 'prev';
      const far = Math.abs(dx) > el.clientWidth / 4 || (fast && Math.abs(dx) > 40);
      if (e.type !== 'touchend' || !far || !has(dir)) return settle();
      // the neighbour slides into the card's place; then the track turns, and the card (now showing
      // it) is put back where it was without a jump, its buttons coming up a moment later
      place(-Math.sign(dx) * (el.offsetWidth + CARD_GAP), 220);
      setTimeout(() => {
        if (!turn(dir)) return settle();
        haptic('tick');
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            place(0, 0);
            hide();
            el.classList.remove('pb-fresh');
            void el.offsetWidth;
            el.classList.add('pb-fresh');
          }),
        );
      }, 230);
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
  }, [ref, peers, turn, enabled]);
}

/** What scrolls sideways itself, or is dragged: a swipe there is its own, not the tabs'. */
const OWN_SIDEWAYS = `${NOT_A_SWIPE}, .shelf, .tabs, .chips, .stories, input[type="range"]`;

function scrollsSideways(target: Element, page: Element) {
  for (let el: Element | null = target; el && el !== page; el = el.parentElement) {
    if (el.matches(OWN_SIDEWAYS)) return true;
    const style = getComputedStyle(el);
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) return true;
  }
  return false;
}

/**
 * A page with tabs (Collection, History) goes to the next tab with a swipe left, the previous with
 * a swipe right — the iPhone (the user, 26.10.2026). Not where something scrolls sideways itself (a
 * row of covers, a slider) or is dragged; up and down stays the page's scroll. The new tab's page
 * slides in from the side it was swiped from (`.tab-from-next` / `.tab-from-prev` on the page).
 */
export function useSwipeTabs<T extends string>(ref: RefObject<HTMLElement | null>, tabs: readonly T[], current: T, go: (tab: T, dir: 'next' | 'prev') => void, enabled = true) {
  useEffect(() => {
    // the whole area under the tabs: a short tab (an empty Albums) leaves most of it below the page,
    // where a swipe went unheard (the user, 26.10.2026)
    const el = ref.current?.closest<HTMLElement>('.main') ?? ref.current;
    if (!el || !enabled || tabs.length < 2) return;
    let start: { x: number; y: number; t: number } | null = null;
    let last = { x: 0, y: 0 };
    // Sideways from its first move: the page does not scroll under it. On a long tab (Albums) the
    // page's scroll took every swipe that went down a little — iOS then ends the touch with
    // touchcancel, not touchend — so only the short tabs turned (the user, 26.10.2026).
    let sideways = false;
    const down = (e: TouchEvent) => {
      const touch = e.touches[0];
      start = e.touches.length === 1 && !scrollsSideways(e.target as Element, el) ? { x: touch.clientX, y: touch.clientY, t: e.timeStamp } : null;
      last = start ? { x: start.x, y: start.y } : last;
      sideways = false;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.touches[0];
      last = { x: touch.clientX, y: touch.clientY };
      const dx = Math.abs(last.x - start.x);
      const dy = Math.abs(last.y - start.y);
      if (!sideways && dx > 10 && dx > 1.5 * dy) sideways = true;
      // down first: the page's own scroll, not a swipe
      else if (!sideways && dy > 10) return void (start = null);
      if (sideways && e.cancelable) e.preventDefault();
    };
    const up = (e: TouchEvent) => {
      if (!start || (e.type !== 'touchend' && !sideways)) return void (start = null);
      const end = e.type === 'touchend' ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } : last;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const fast = Math.abs(dx) / Math.max(1, e.timeStamp - start.t) > FLICK;
      start = null;
      // sideways, clearly: far enough or a flick, and much more across than down
      if (Math.abs(dx) < (fast ? 40 : 80) || Math.abs(dx) < 2 * Math.abs(dy)) return;
      const at = tabs.indexOf(current);
      const dir = dx < 0 ? 'next' : 'prev';
      const to = tabs[at + (dir === 'next' ? 1 : -1)];
      if (at < 0 || !to) return;
      haptic('tick');
      go(to, dir);
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', up);
      el.removeEventListener('touchcancel', up);
    };
  }, [ref, tabs, current, go, enabled]);
}
