// Reordering a list by dragging (the user's wish: own playlists, Liked, the queue). Rows carry
// `data-sort-index`. With a mouse a row itself is dragged once the press moves a few pixels
// (a click, a double click and the menu stay as they were); on a touch screen the drag starts on
// a row's `.drag-handle` (the iPhone shows handles in its "Move" mode). A line shows where the row
// lands; near the top or the bottom of the scrolling page it scrolls along.

import { useEffect, useRef, type RefObject } from 'react';

const START = 6; // px the mouse moves before a press becomes a drag
const EDGE = 70; // px from the scroller's edge where it scrolls along

export interface DragSortOptions {
  enabled: boolean;
  /** `row`: a mouse drags the row itself; `handle`: the drag starts on `.drag-handle` (touch). */
  mode: 'row' | 'handle';
  onMove(from: number, to: number): void;
  /** What scrolls while dragging near its edges (the page by default). */
  scroller?: () => HTMLElement | null;
}

export function useDragSort(container: RefObject<HTMLElement | null>, opts: DragSortOptions) {
  const { enabled, mode, scroller } = opts;
  // The latest handler, whatever re-renders happen mid-drag (they must not cut a drag off).
  const onMove = useRef(opts.onMove);
  useEffect(() => {
    onMove.current = opts.onMove;
  });
  useEffect(() => {
    const box = container.current;
    if (!box || !enabled) return;
    let drag: { id: number; row: HTMLElement; from: number; y: number; started: boolean } | null = null;
    let target: { row: HTMLElement; after: boolean } | null = null;
    let scrolling = 0;
    let lastY = 0;

    const rows = () => [...box.querySelectorAll<HTMLElement>('[data-sort-index]')];
    const mark = (next: typeof target) => {
      if (target?.row !== next?.row || target?.after !== next?.after) {
        target?.row.classList.remove('drop-before', 'drop-after');
        next?.row.classList.add(next.after ? 'drop-after' : 'drop-before');
      }
      target = next;
    };
    const over = (y: number) => {
      for (const row of rows()) {
        const r = row.getBoundingClientRect();
        if (y >= r.top && y < r.bottom) return mark(row === drag?.row ? null : { row, after: y > r.top + r.height / 2 });
      }
    };
    const scroll = () => {
      const s = scroller?.() ?? box.closest<HTMLElement>('.main, .queue, .q-sheet-list');
      if (!s || !drag?.started) return (scrolling = 0);
      const r = s.getBoundingClientRect();
      const speed = lastY < r.top + EDGE ? -(r.top + EDGE - lastY) / 4 : lastY > r.bottom - EDGE ? (lastY - (r.bottom - EDGE)) / 4 : 0;
      if (speed) {
        s.scrollTop += speed;
        over(lastY);
      }
      scrolling = requestAnimationFrame(scroll);
    };
    const start = () => {
      if (!drag) return;
      drag.started = true;
      drag.row.classList.add('drag-source');
      box.classList.add('sorting');
      scrolling = requestAnimationFrame(scroll);
    };
    const finish = (commit: boolean) => {
      if (!drag) return;
      const { row, from, started } = drag;
      drag = null;
      cancelAnimationFrame(scrolling);
      row.classList.remove('drag-source');
      box.classList.remove('sorting');
      if (started) {
        // The click that ends a drag is not a click on the row (it comes right after the release).
        const swallow = (ev: Event) => (ev.stopPropagation(), ev.preventDefault());
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
      const t = target;
      mark(null);
      if (!commit || !started || !t) return;
      const at = Number(t.row.dataset.sortIndex) + (t.after ? 1 : 0);
      const to = at > from ? at - 1 : at;
      if (to !== from) onMove.current(from, to);
    };

    const down = (e: PointerEvent) => {
      const el = e.target as Element;
      const row = el.closest<HTMLElement>('[data-sort-index]');
      if (!row || drag) return;
      if (mode === 'row' ? e.pointerType !== 'mouse' || e.button !== 0 || el.closest('button, a, input') : !el.closest('.drag-handle')) return;
      drag = { id: e.pointerId, row, from: Number(row.dataset.sortIndex), y: e.clientY, started: false };
      lastY = e.clientY;
      if (mode === 'handle') {
        e.preventDefault();
        start();
      }
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      lastY = e.clientY;
      if (!drag.started) {
        if (Math.abs(e.clientY - drag.y) < START) return;
        start();
      }
      e.preventDefault();
      over(e.clientY);
    };
    const up = (e: PointerEvent) => drag && e.pointerId === drag.id && finish(e.type === 'pointerup');

    box.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      finish(false);
      box.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [container, enabled, mode, scroller]);
}

/** The list with one item taken from `from` and put at `to`. */
export function moved<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
