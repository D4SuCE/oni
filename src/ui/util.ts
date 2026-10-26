import { useEffect, useRef, useState, type DependencyList } from 'react';
import { tr } from '../i18n.ts';

export function fmtTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtTotal(ms: number) {
  const min = Math.round(ms / 60000);
  return tr().count.duration(Math.floor(min / 60), min % 60);
}

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (d: T) => void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    fn().then(
      (d) => alive && (setData(d), setLoading(false)),
      (e) => alive && (setError(e), setLoading(false)),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/** What lies over the page and takes Escape itself: a menu, a dialog, Now Playing and its
 * sheets, the sound panel, the recap stories. */
const OVER_PAGE = '.menu, .dialog-backdrop, .nowplaying, .sound-backdrop, .stories';

/**
 * Escape for something of the page's own (a search field; the user, 26.10.2026: Escape closes
 * the search and a playlist's search) — only when nothing lies over the page, which closes first.
 */
export function useEscape(onEscape: () => void, enabled = true) {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector(OVER_PAGE)) handler.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
