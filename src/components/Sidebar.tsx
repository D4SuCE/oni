import { ChevronLeft, Heart, History, Home, Library, ListMusic, Plus, Search, Settings } from 'lucide-react';
import { useT } from '../i18n.ts';
import { back, createPlaylist, isOwn, navigate, samePlaylist, useApp, type Route } from '../store.ts';
import { cx } from '../ui/util.ts';
import { askText } from './Dialog.tsx';

const NAV: { route: Route & { name: 'home' | 'search' | 'library' }; icon: typeof Home }[] = [
  { route: { name: 'home' }, icon: Home },
  { route: { name: 'search' }, icon: Search },
  { route: { name: 'library' }, icon: Library },
];

export function Sidebar() {
  const route = useApp((s) => s.route);
  const canBack = useApp((s) => s.backStack.length > 0);
  const playlists = useApp((s) => s.playlists);
  const likedPlaylists = useApp((s) => s.likedPlaylists);
  const own = playlists.filter((p) => isOwn(p));
  const t = useT();
  const isActive = (r: Route) => route.name === r.name && !(r.name === 'library' && route.name === 'library' && route.tab === 'tracks');

  return (
    <nav className="sidebar">
      <div className="sidebar-top drag">
        <button className="icon-btn no-drag" onClick={back} disabled={!canBack} title={t.common.back}>
          <ChevronLeft size={20} />
        </button>
        <div className="logo">
          <span className="logo-mark" />
          Wave
        </div>
      </div>
      <div className="nav">
        {NAV.map(({ route: r, icon: Icon }) => (
          <button key={r.name} className={cx('nav-item', isActive(r) && 'active')} onClick={() => navigate(r)} data-testid={`nav-${r.name}`}>
            <Icon size={19} />
            {t.nav[r.name]}
          </button>
        ))}
        <button className={cx('nav-item', route.name === 'library' && route.tab === 'tracks' && 'active')} onClick={() => navigate({ name: 'library', tab: 'tracks' })} data-testid="nav-liked">
          <Heart size={19} />
          {t.common.liked}
        </button>
        <button className={cx('nav-item', route.name === 'history' && 'active')} onClick={() => navigate({ name: 'history' })} data-testid="nav-history">
          <History size={19} />
          {t.nav.history}
        </button>
      </div>
      <div className="nav-section">
        <span>{t.common.playlists}</span>
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
            <span className="ellipsis">
              {p.title}
              {!isOwn(p) && <span className="nav-owner"> · {p.owner?.name || p.owner?.login}</span>}
            </span>
          </button>
        ))}
      </div>
      <button className={cx('nav-item', route.name === 'settings' && 'active')} onClick={() => navigate({ name: 'settings' })}>
        <Settings size={19} />
        {t.nav.settings}
      </button>
    </nav>
  );
}
