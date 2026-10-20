import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

function MenuList({ items, x, y, nested }: { items: MenuItem[]; x: number; y: number; nested?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = nested ? x - r.width - 220 : window.innerWidth - r.width - 8;
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, nx), y: ny });
  }, [x, y, nested]);

  return (
    <div ref={ref} className="menu glass" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={cx('menu-item', it.danger && 'danger', sub?.i === i && 'active')}
            onMouseEnter={(e) => {
              if (!it.submenu) return setSub(null);
              const r = e.currentTarget.getBoundingClientRect();
              setSub({ i, x: r.right + 4, y: r.top - 6 });
            }}
            onClick={() => {
              if (it.submenu) return;
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
      {sub && items[sub.i]?.submenu && <MenuList items={items[sub.i].submenu!} x={sub.x} y={sub.y} nested />}
    </div>
  );
}

export function MenuHost() {
  const menu = useMenu();
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);
  if (!menu) return null;
  return <MenuList items={menu.items} x={menu.x} y={menu.y} />;
}
