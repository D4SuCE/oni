import { Heart, Play, Plus, Shuffle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { AlbumCard, ArtistCard, ErrorBox, PlaylistCard, Spinner } from '../components/Common.tsx';
import { askText } from '../components/Dialog.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT, type Dict } from '../i18n.ts';
import { playShuffled, playTracks } from '../player/player.ts';
import { createPlaylist, navigate, useApp, type LibraryTab } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';

const TABS: LibraryTab[] = ['tracks', 'playlists', 'albums', 'artists'];
const tabLabel = (tab: LibraryTab, t: Dict) => (tab === 'tracks' ? t.common.liked : t.common[tab]);

const FIRST_PAGE = 100;

function LikedTracks() {
  const keys = useApp((s) => s.likedKeys);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const t = useT();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const first = await api.tracks(keys.slice(0, FIRST_PAGE));
        if (!alive) return;
        setTracks(first);
        if (keys.length > FIRST_PAGE) {
          const rest = await api.tracks(keys.slice(FIRST_PAGE));
          if (alive) setTracks([...first, ...rest]);
        }
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [keys]);

  if (error) return <ErrorBox error={error} />;
  if (!tracks) return <Spinner label={t.library.loadingLikes} />;
  return (
    <>
      <div className="lib-actions">
        <button className="btn primary" onClick={() => playTracks(tracks, 0, t.common.liked)} disabled={!tracks.length}>
          <Play size={16} fill="currentColor" /> {t.common.play}
        </button>
        <button className="btn glass-btn" onClick={() => playShuffled(tracks, t.common.liked)} disabled={!tracks.length}>
          <Shuffle size={16} /> {t.common.shuffle}
        </button>
        <span className="muted">{t.count.tracks(keys.length)}</span>
      </div>
      {tracks.length ? <TrackList tracks={tracks} onPlay={(i) => playTracks(tracks, i, t.common.liked)} /> : <div className="empty-hint">{t.library.likedEmpty}</div>}
    </>
  );
}

function Playlists() {
  const playlists = useApp((s) => s.playlists);
  const t = useT();
  return (
    <div className="grid">
      <button
        className="card new-card"
        onClick={async () => {
          const title = await askText(t.common.newPlaylist, '', t.common.create);
          if (title) {
            const pl = await createPlaylist(title);
            navigate({ name: 'playlist', uid: pl.uid, kind: pl.kind });
          }
        }}
      >
        <div className="card-cover new-cover">
          <Plus size={36} />
        </div>
        <div className="card-title">{t.common.newPlaylist}</div>
      </button>
      {playlists.map((p) => (
        <PlaylistCard key={p.kind} playlist={p} />
      ))}
    </div>
  );
}

function Albums() {
  const { data, loading, error, reload } = useAsync(() => api.likedAlbums(), []);
  const t = useT();
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data!.length) return <div className="empty-hint">{t.library.noAlbums}</div>;
  return (
    <div className="grid">
      {data!.map((a) => (
        <AlbumCard key={a.id} album={a} />
      ))}
    </div>
  );
}

function Artists() {
  const { data, loading, error, reload } = useAsync(() => api.likedArtists(), []);
  const t = useT();
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data!.length) return <div className="empty-hint">{t.library.noArtists}</div>;
  return (
    <div className="grid">
      {data!.map((a) => (
        <ArtistCard key={a.id} artist={a} />
      ))}
    </div>
  );
}

export function Library({ tab = 'tracks' }: { tab?: LibraryTab }) {
  const t = useT();
  return (
    <div className="page">
      <h1 className="page-title">
        <Heart size={26} /> {t.nav.library}
      </h1>
      <div className="tabs big">
        {TABS.map((id) => (
          <button key={id} className={cx('tab', id === tab && 'active')} onClick={() => navigate({ name: 'library', tab: id })}>
            {tabLabel(id, t)}
          </button>
        ))}
      </div>
      {tab === 'tracks' && <LikedTracks />}
      {tab === 'playlists' && <Playlists />}
      {tab === 'albums' && <Albums />}
      {tab === 'artists' && <Artists />}
    </div>
  );
}
