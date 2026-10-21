import { HardDriveDownload, Heart, History, Home, Library, ListMusic, Menu, Plus, Search, Settings } from 'lucide-react';
import { create } from 'zustand';
import { useT } from '../i18n.ts';
import { createPlaylist, isOwn, navigate, samePlaylist, useApp, type Route } from '../store.ts';
import { offline } from '../player/player.ts';
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
  const t = useT();
  const isActive = (r: Route) =>
    (route.name === r.name && !(r.name === 'library' && route.name === 'library' && route.tab === 'tracks')) ||
    // On the iPhone Downloads is a Collection tab (src/views/Library.tsx).
    (isIos && r.name === 'library' && route.name === 'downloads');
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
        {offline && (
          <button className={cx('nav-item', route.name === 'downloads' && 'active')} onClick={() => navigate({ name: 'downloads' })} data-testid="nav-downloads" title={tip(t.nav.downloads)}>
            <HardDriveDownload size={19} />
            <span className="nav-label">{t.nav.downloads}</span>
          </button>
        )}
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
        {[...own, ...likedPlaylists].map((p) => (
          <button
            key={`${p.uid}-${p.kind}`}
            className={cx('nav-item small', route.name === 'playlist' && samePlaylist(route, p) && 'active')}
            onClick={() => navigate({ name: 'playlist', uid: p.uid, kind: p.kind })}
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
