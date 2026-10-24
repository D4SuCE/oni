import { useCallback, useEffect, useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useT } from './i18n.ts';
import { api } from './api/client.ts';
import { Spinner } from './components/Common.tsx';
import { DialogHost } from './components/Dialog.tsx';
import { TrackSheetHost } from './components/TrackSheet.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { MenuHost } from './components/Menu.tsx';
import { NowPlaying } from './components/NowPlaying.tsx';
import { PlayerBar } from './components/PlayerBar.tsx';
import { Sidebar, useSidebar } from './components/Sidebar.tsx';
import { SoundPanel } from './components/SoundPanel.tsx';
import { eqOutputLevel } from './player/eq.ts';
import { pulseLevel, pulseTempo } from './player/pulse.ts';
import { cx } from './ui/util.ts';
import { deviceSync, disk, syncNow, useSync } from './sync/index.ts';
import { elsewhereSync, leave, look, publish, useElsewhere } from './sync/elsewhere.ts';
import { TuningPanel } from './components/Wave.tsx';
import { audio, current, next, offline, playTracks, prev, restoreSession, setSleep, setVolume, toggle, usePlayer } from './player/player.ts';
import { back, historyStep, init, navigate, toast, toggleLike, useApp } from './store.ts';
import { AlbumView } from './views/Album.tsx';
import { ArtistView } from './views/Artist.tsx';
import { HistoryView } from './views/History.tsx';
import { Home } from './views/Home.tsx';
import { Library } from './views/Library.tsx';
import { MixView } from './views/Mix.tsx';
import { Login } from './views/Login.tsx';
import { PlaylistView } from './views/Playlist.tsx';
import { Search } from './views/Search.tsx';
import { SettingsView } from './views/Settings.tsx';
import { isIos } from './ui/platform.ts';
import { useSwipeBack } from './ui/swipe.ts';
import { useCover } from './ui/offline.ts';

/** Blurred cover of the current track behind everything, cross-faded between tracks. */
function Backdrop() {
  const track = usePlayer((s) => s.queue[s.index]);
  const url = useCover(track, 200);
  const [layers, setLayers] = useState<{ url: string; id: number }[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setLayers((l) => [...l.slice(-1), { url, id: ++seq.current }]);
    img.src = url;
  }, [url]);
  return (
    <div className="backdrop" aria-hidden>
      <div className="backdrop-art" />
      {layers.map((l) => (
        <div key={l.id} className="backdrop-img" style={{ backgroundImage: `url("${l.url}")` }} />
      ))}
      <div className="backdrop-tint" />
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+← / Alt+→: back and forward, as in a browser
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        return historyStep(e.key === 'ArrowLeft' ? 'back' : 'forward');
      }
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, [contenteditable]') && !(e.ctrlKey && e.key.toLowerCase() === 'f')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.code === 'Space' && !ctrl) {
        e.preventDefault();
        toggle();
      } else if (ctrl && e.key === 'ArrowRight') next(true);
      else if (ctrl && e.key === 'ArrowLeft') prev();
      else if (ctrl && e.key === 'ArrowUp') (e.preventDefault(), setVolume(usePlayer.getState().volume + 0.05));
      else if (ctrl && e.key === 'ArrowDown') (e.preventDefault(), setVolume(usePlayer.getState().volume - 0.05));
      else if (ctrl && e.code === 'KeyL') {
        const t = current();
        if (t) toggleLike(t);
      } else if (ctrl && e.code === 'KeyF') {
        e.preventDefault();
        navigate({ name: 'search' });
      }
    };
    // Mouse buttons 4 and 5 (the side "back" / "forward" buttons)
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.type === 'mouseup') historyStep(e.button === 3 ? 'back' : 'forward');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);
}

function Main() {
  const route = useApp((s) => s.route);
  const navDir = useApp((s) => s.navDir);
  const offline = useApp((s) => s.offline);
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  // Block body on purpose: Chromium's scrollTo() now returns a Promise, which React would treat as the cleanup.
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [route]);
  // The iPhone: a page opened from somewhere (a playlist, an album, a mix, an artist) goes back
  // with a pull down from its top. The tabs' own pages have nowhere to go back to.
  const view$ = useCallback(() => ref.current?.querySelector<HTMLElement>('.view-enter') ?? null, []);
  useSwipeBack(ref, view$, back, isIos && ['playlist', 'album', 'mix', 'artist'].includes(route.name));
  let view;
  switch (route.name) {
    case 'home':
      view = <Home />;
      break;
    case 'search':
      view = <Search />;
      break;
    case 'library':
      view = <Library tab={route.tab} />;
      break;
    case 'album':
      view = <AlbumView id={route.id} />;
      break;
    case 'artist':
      view = <ArtistView id={route.id} />;
      break;
    case 'playlist':
      view = <PlaylistView uid={route.uid} kind={route.kind} />;
      break;
    case 'history':
      view = <HistoryView />;
      break;
    case 'mix':
      view = <MixView id={route.id} />;
      break;
    case 'downloads':
      // A Library tab, its tabs above it (src/views/Library.tsx).
      view = <Library tab="downloads" />;
      break;
    case 'settings':
      view = <SettingsView />;
      break;
  }
  return (
    <main className="main" ref={ref}>
      <div className="main-drag drag" />
      {offline && (
        <div className="offline-banner" data-testid="offline-banner">
          <WifiOff size={15} /> {t.downloads.offlineBanner}
        </div>
      )}
      <div key={JSON.stringify(route)} className={cx('view-enter', navDir === 'back' && 'from-left')}>
        <ErrorBoundary kind="view">{view}</ErrorBoundary>
      </div>
    </main>
  );
}

export function App() {
  const auth = useApp((s) => s.auth);
  const nowPlaying = useApp((s) => s.nowPlayingOpen);
  const tuning = useApp((s) => s.tuningOpen);
  const sound = useApp((s) => s.soundOpen);
  const toastMsg = useApp((s) => s.toast);
  const sidebarOpen = useSidebar((s) => s.open);
  const error = usePlayer((s) => s.error);
  useShortcuts();

  useEffect(() => {
    init();
    restoreSession();
  }, []);

  // A playback error is an ordinary toast that goes away by itself (it was set straight into the
  // state, past toast()'s timer, and stayed up for good); cleared, so the same error shows again.
  useEffect(() => {
    if (!error) return;
    toast(error);
    usePlayer.setState({ error: null });
  }, [error]);

  return (
    <div className={cx('app-root', !sidebarOpen && 'sidebar-collapsed')} data-platform={window.wave?.platform}>
      <Backdrop />
      {auth === 'loading' && (
        <div className="center-fill drag">
          <Spinner />
        </div>
      )}
      {auth === 'login' && (
        <>
          <div className="main-drag drag" />
          <Login />
        </>
      )}
      {auth === 'ready' && (
        <div className="shell">
          <Sidebar />
          <Main />
          <PlayerBar />
        </div>
      )}
      {auth === 'ready' && nowPlaying && <NowPlaying />}
      {auth === 'ready' && tuning && <TuningPanel />}
      {auth === 'ready' && sound && <SoundPanel />}
      <MenuHost />
      <DialogHost />
      <TrackSheetHost />
      {toastMsg && (
        <div key={toastMsg.id} className="toast glass" onClick={() => useApp.setState({ toast: null })} data-testid="toast">
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

// Handy for debugging and for the automated UI test.
Object.assign(window, {
  __wave: { offline, usePlayer, useApp, audio, api, navigate, playTracks, setSleep, toggleLike, eqOutputLevel, pulseLevel, pulseTempo, sync: { disk, deviceSync, syncNow, useSync, elsewhere: { look, publish, leave, useElsewhere, elsewhereSync } } },
});
