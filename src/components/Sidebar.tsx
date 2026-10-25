import { Heart, History, Home, Library, ListMusic, Menu, Plus, Search, Settings } from 'lucide-react';
import { useState } from 'react';
import { create } from 'zustand';
import type { Playlist } from '../api/types.ts';
import { useT } from '../i18n.ts';
import { createPlaylist, isOwn, navigate, samePlaylist, useApp, type Route } from '../store.ts';
import { isIos } from '../ui/platform.ts';
import { useUpdate } from '../ui/update.ts';
import { cx } from '../ui/util.ts';
import { askText } from './Dialog.tsx';

const NAV: { route: Route & { name: 'home' | 'search' | 'library' }; icon: typeof Home }[] = [
  { route: { name: 'home' }, icon: Home },
  { route: { name: 'search' }, icon: Search },
  { route: { name: 'library' }, icon: Library },
];

const KEY = 'ui.sidebar.open';
const stored = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Collapsed (icons only) by default; ☰ opens the labels. Remembered between runs. */
export const useSidebar = create<{ open: boolean }>(() => ({ open: stored() }));

/**
 * The playlists' own order, dragged by the user (Windows): Yandex keeps no order of its own one can
 * set, so it is this device's. Playlists not placed yet (new ones) come after the placed ones.
 */
const ORDER_KEY = 'ui.sidebar.order';
const playlistKey = (p: { uid: number | string; kind: number | string }) => `${p.uid}:${p.kind}`;
const useSidebarOrder = create<{ order: string[] }>(() => {
  try {
    return { order: JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') };
  } catch {
    return { order: [] };
  }
});

function inOrder(list: Playlist[], order: string[]) {
  const place = new Map(order.map((k, i) => [k, i]));
  return list
    .map((p, i) => ({ p, i, at: place.get(playlistKey(p)) }))
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.i - b.i)
    .map((x) => x.p);
}

/** Moves `from` before or after `to` and keeps the whole order as it is now on screen. */
function movePlaylist(list: Playlist[], from: string, to: string, after: boolean) {
  const keys = list.map(playlistKey).filter((k) => k !== from);
  const at = keys.indexOf(to);
  if (at < 0 || from === to) return;
  keys.splice(after ? at + 1 : at, 0, from);
  useSidebarOrder.setState({ order: keys });
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(keys));
  } catch {
    /* storage unavailable */
  }
}

function toggleSidebar() {
  const open = !useSidebar.getState().open;
  useSidebar.setState({ open });
  try {
    localStorage.setItem(KEY, open ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export function Sidebar() {
  const route = useApp((s) => s.route);
  const playlists = useApp((s) => s.playlists);
  const likedPlaylists = useApp((s) => s.likedPlaylists);
  const open = useSidebar((s) => s.open);
  const updateReady = useUpdate((s) => s.status === 'ready');
  const own = playlists.filter((p) => isOwn(p));
  const order = useSidebarOrder((s) => s.order);
  const listed = inOrder([...own, ...likedPlaylists], order);
  // Dragging (not on the iPhone, which has no sidebar): which one, and where it would land.
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);
  const t = useT();
  const isActive = (r: Route) =>
    (route.name === r.name && !(r.name === 'library' && route.name === 'library' && route.tab === 'tracks')) ||
    // Downloads is a Library tab (src/views/Library.tsx).
    (r.name === 'library' && route.name === 'downloads');
  // Collapsed, the labels are hidden: show them as tooltips instead.
  const tip = (label: string) => (open ? undefined : label);

  return (
    <nav className={cx('sidebar', !open && 'collapsed')}>
      <div className="sidebar-top drag">
        <button className="logo no-drag" onClick={() => navigate({ name: 'home' })} title={t.nav.home} data-testid="logo">
          <span className="logo-mark" />
          <span className="logo-name nav-label">ONI</span>
          <span className="logo-kanji nav-label">鬼</span>
        </button>
      </div>
      <div className="sidebar-tools no-drag">
        <button className="icon-btn" onClick={toggleSidebar} title={open ? t.nav.collapse : t.nav.expand} data-testid="sidebar-toggle">
          <Menu size={19} />
        </button>
      </div>
      <div className="nav">
        {NAV.map(({ route: r, icon: Icon }) => (
          <button key={r.name} className={cx('nav-item', isActive(r) && 'active')} onClick={() => navigate(r)} data-testid={`nav-${r.name}`} title={tip(t.nav[r.name])}>
            <Icon size={19} />
            <span className="nav-label">{t.nav[r.name]}</span>
          </button>
        ))}
        <button
          className={cx('nav-item', route.name === 'library' && route.tab === 'tracks' && 'active')}
          onClick={() => navigate({ name: 'library', tab: 'tracks' })}
          data-testid="nav-liked"
          title={tip(t.common.liked)}
        >
          <Heart size={19} />
          <span className="nav-label">{t.common.liked}</span>
        </button>
        <button className={cx('nav-item', route.name === 'history' && 'active')} onClick={() => navigate({ name: 'history' })} data-testid="nav-history" title={tip(t.nav.history)}>
          <History size={19} />
          <span className="nav-label">{t.nav.history}</span>
        </button>
      </div>
      <div className="nav-section">
        <span className="nav-label">{t.common.playlists}</span>
        <button
          className="icon-btn small"
          title={t.common.newPlaylist}
          onClick={async () => {
            const title = await askText(t.common.newPlaylist, '', t.common.create);
            if (title) {
              const pl = await createPlaylist(title);
              navigate({ name: 'playlist', uid: pl.uid, kind: pl.kind });
            }
          }}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="nav-playlists">
        {listed.map((p) => (
          <button
            key={`${p.uid}-${p.kind}`}
            className={cx(
              'nav-item small',
              route.name === 'playlist' && samePlaylist(route, p) && 'active',
              dragged === playlistKey(p) && 'dragging',
              drop?.key === playlistKey(p) && (drop.after ? 'drop-after' : 'drop-before'),
            )}
            onClick={() => navigate({ name: 'playlist', uid: p.uid, kind: p.kind })}
            draggable={!isIos}
            onDragStart={(e) => {
              setDragged(playlistKey(p));
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', playlistKey(p));
            }}
            onDragOver={(e) => {
              if (!dragged) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > box.top + box.height / 2;
              if (drop?.key !== playlistKey(p) || drop.after !== after) setDrop({ key: playlistKey(p), after });
            }}
            onDragLeave={() => drop?.key === playlistKey(p) && setDrop(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragged && drop) movePlaylist(listed, dragged, drop.key, drop.after);
              setDragged(null);
              setDrop(null);
            }}
            onDragEnd={() => {
              setDragged(null);
              setDrop(null);
            }}
            data-testid="nav-playlist"
            title={isOwn(p) ? p.title : `${p.title} · ${p.owner?.name || p.owner?.login || ''}`}
          >
            <ListMusic size={16} />
            <span className="ellipsis nav-label">
              {p.title}
              {!isOwn(p) && <span className="nav-owner"> · {p.owner?.name || p.owner?.login}</span>}
            </span>
          </button>
        ))}
      </div>
      <button className={cx('nav-item', route.name === 'settings' && 'active')} onClick={() => navigate({ name: 'settings' })} title={tip(t.nav.settings)} data-testid="nav-settings">
        <Settings size={19} />
        <span className="nav-label">{t.nav.settings}</span>
        {updateReady && <span className="nav-dot" data-testid="update-dot" title={t.update.install} />}
      </button>
    </nav>
  );
}
