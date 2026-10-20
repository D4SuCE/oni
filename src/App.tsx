import { useEffect, useRef, useState } from 'react';
import { api } from './api/client.ts';
import { trackCover } from './api/yandex.ts';
import { Spinner } from './components/Common.tsx';
import { DialogHost } from './components/Dialog.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { MenuHost } from './components/Menu.tsx';
import { NowPlaying } from './components/NowPlaying.tsx';
import { PlayerBar } from './components/PlayerBar.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TuningPanel } from './components/Wave.tsx';
import { audio, current, next, playTracks, prev, restoreSession, setVolume, toggle, usePlayer } from './player/player.ts';
import { init, navigate, toggleLike, useApp } from './store.ts';
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

/** Blurred cover of the current track behind everything, cross-faded between tracks. */
function Backdrop() {
  const track = usePlayer((s) => s.queue[s.index]);
  const url = trackCover(track, 200);
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Main() {
  const route = useApp((s) => s.route);
  const ref = useRef<HTMLElement>(null);
  // Block body on purpose: Chromium's scrollTo() now returns a Promise, which React would treat as the cleanup.
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [route]);
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
    case 'settings':
      view = <SettingsView />;
      break;
  }
  return (
    <main className="main" ref={ref}>
      <div className="main-drag drag" />
      <div key={JSON.stringify(route)} className="view-enter">
        <ErrorBoundary kind="view">{view}</ErrorBoundary>
      </div>
    </main>
  );
}

export function App() {
  const auth = useApp((s) => s.auth);
  const nowPlaying = useApp((s) => s.nowPlayingOpen);
  const tuning = useApp((s) => s.tuningOpen);
  const toastMsg = useApp((s) => s.toast);
  const error = usePlayer((s) => s.error);
  useShortcuts();

  useEffect(() => {
    init();
    restoreSession();
  }, []);

  useEffect(() => {
    if (error) useApp.setState({ toast: { id: Date.now(), text: error } });
  }, [error]);

  return (
    <div className="app-root" data-platform={window.wave?.platform}>
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
      <MenuHost />
      <DialogHost />
      {toastMsg && (
        <div key={toastMsg.id} className="toast glass">
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

// Handy for debugging and for the automated UI test.
Object.assign(window, { __wave: { usePlayer, useApp, audio, api, navigate, playTracks } });
