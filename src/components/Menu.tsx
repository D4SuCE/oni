import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { create } from 'zustand';
import { cx } from '../ui/util.ts';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  submenu?: MenuItem[];
  danger?: boolean;
  separator?: boolean;
}

const useMenu = create<{ x: number; y: number; items: MenuItem[] } | null>(() => null);

export function openMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault?.();
  e.stopPropagation?.();
  useMenu.setState({ x: e.clientX, y: e.clientY, items }, true);
}

const close = () => useMenu.setState(null, true);

/** How long a submenu stays while the pointer crosses other items on its way there. */
const SUBMENU_GRACE = 300;

interface Sub {
  i: number;
  /** Where it opens: right of the item, or, without room there, left of `parentLeft`. */
  x: number;
  y: number;
  parentLeft: number;
}

function MenuList({ items, x, y, parentLeft, onEnter }: { items: MenuItem[]; x: number; y: number; parentLeft?: number; onEnter?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<Sub | null>(null);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nested = parentLeft !== undefined;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = nested ? parentLeft - r.width - 4 : window.innerWidth - r.width - 8;
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, nx), y: ny });
  }, [x, y, nested, parentLeft]);

  useEffect(() => {
    return () => clearTimeout(leaving.current);
  }, []);

  const openSub = (i: number, el: HTMLElement) => {
    clearTimeout(leaving.current);
    const r = el.getBoundingClientRect();
    const menu = ref.current!.getBoundingClientRect();
    setSub({ i, x: menu.right + 2, y: r.top - 6, parentLeft: menu.left });
  };

  return (
    <div ref={ref} className="menu glass" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()} onMouseEnter={onEnter}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={cx('menu-item', it.danger && 'danger', sub?.i === i && 'active')}
            onMouseEnter={(e) => {
              if (it.submenu) return openSub(i, e.currentTarget);
              // Crossing other items on the way to an open submenu must not close it at once.
              clearTimeout(leaving.current);
              leaving.current = setTimeout(() => setSub(null), SUBMENU_GRACE);
            }}
            onClick={(e) => {
              if (it.submenu) return openSub(i, e.currentTarget);
              close();
              it.onClick?.();
            }}
          >
            <span className="menu-icon">{it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.submenu && <ChevronRight size={14} className="menu-chevron" />}
          </button>
        ),
      )}
      {/*
        The submenu goes to <body>, not inside this list: the list's glass backdrop-filter makes it
        the containing block of fixed children, which would offset the submenu by the list's own position.
      */}
      {sub &&
        items[sub.i]?.submenu &&
        createPortal(<MenuList items={items[sub.i].submenu!} x={sub.x} y={sub.y} parentLeft={sub.parentLeft} onEnter={() => clearTimeout(leaving.current)} />, document.body)}
    </div>
  );
}

export function MenuHost() {
  const menu = useMenu();
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Scrolling the page away from the menu closes it; scrolling a long menu itself must not.
    // Only the user's own scrolling counts (wheel, touchpad, swipe): a "scroll" event also comes
    // when the page moves by itself (a route change, content loading in), which would close a
    // menu just opened.
    const onUserScroll = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest('.menu'))) close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onUserScroll, { capture: true, passive: true });
    window.addEventListener('touchmove', onUserScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onUserScroll, { capture: true });
      window.removeEventListener('touchmove', onUserScroll, { capture: true });
    };
  }, [menu]);
  if (!menu) return null;
  return <MenuList items={menu.items} x={menu.x} y={menu.y} />;
}
