import { Heart, Library as LibraryIcon, Play, Plus, Shuffle } from 'lucide-react';
import { isIos } from '../ui/platform.ts';
import { DownloadButton } from '../components/DownloadButton.tsx';
import { DownloadsView } from './Downloads.tsx';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { AlbumCard, ArtistCard, ErrorBox, PlaylistCard, Section, Spinner } from '../components/Common.tsx';
import { askText } from '../components/Dialog.tsx';
import { SmartShuffleButton } from '../components/SmartShuffle.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { offline, playShuffled, playTracks } from '../player/player.ts';
import { createPlaylist, navigate, useApp, type LibraryTab } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';
import { useListSearch } from '../components/ListSearch.tsx';

/** "tracks" (liked songs) is its own page, reached from the sidebar or the Liked Songs card. */
const TABS = ['playlists', 'albums', 'artists'] as const;

const FIRST_PAGE = 100;

function LikedTracks() {
  const keys = useApp((s) => s.likedKeys);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const t = useT();
  // Liked tracks are the account's playlist number 3.
  const uid = useApp((s) => s.account?.uid);
  const from = { playlist: `${uid}:3` };

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

  const search = useListSearch();
  if (error) return <ErrorBox error={error} />;
  if (!tracks) return <Spinner label={t.library.loadingLikes} />;
  return (
    <>
      <div className="lib-actions">
        <button className="btn primary" onClick={() => playTracks(tracks, 0, t.common.liked, from)} disabled={!tracks.length}>
          <Play size={16} fill="currentColor" /> {t.common.play}
        </button>
        <button className="btn glass-btn" onClick={() => playShuffled(tracks, t.common.liked, from)} disabled={!tracks.length}>
          <Shuffle size={16} /> {t.common.shuffle}
        </button>
        <SmartShuffleButton tracks={tracks} title={t.common.liked} from={from} />
        {/* Only the whole list: the first page alone would download the newest hundred. */}
        {tracks.length >= keys.length && <DownloadButton listKey="liked" tracks={tracks} />}
        {tracks.length > 0 && search.button}
        <span className="muted">{t.count.tracks(keys.length)}</span>
      </div>
      {search.field}
      {tracks.length ? (
        <TrackList tracks={tracks} filter={search.query} onPlay={(i) => playTracks(tracks, i, t.common.liked, from)} />
      ) : (
        <div className="empty-hint">{t.library.likedEmpty}</div>
      )}
    </>
  );
}

function NewPlaylistCard() {
  const t = useT();
  return (
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
  );
}

/** Liked tracks shown as a playlist, like Spotify's "Liked Songs". */
export function LikedSongsCard() {
  const count = useApp((s) => s.likedKeys.length);
  const t = useT();
  return (
    <button className="card" onClick={() => navigate({ name: 'library', tab: 'tracks' })} data-testid="liked-card">
      <div className="card-cover liked-cover">
        <Heart size={44} fill="currentColor" />
      </div>
      <div className="card-title">{t.common.liked}</div>
      <div className="card-sub">{t.count.tracksShort(count)}</div>
    </button>
  );
}

function Playlists() {
  const playlists = useApp((s) => s.playlists);
  const liked = useApp((s) => s.likedPlaylists);
  const t = useT();
  return (
    <>
      <Section title={t.library.yourPlaylists}>
        <div className="grid">
          <NewPlaylistCard />
          <LikedSongsCard />
          {playlists.map((p) => (
            <PlaylistCard key={`${p.uid}-${p.kind}`} playlist={p} />
          ))}
        </div>
      </Section>
      <Section title={t.library.likedPlaylists}>
        {liked.length ? (
          <div className="grid" data-testid="liked-playlists">
            {liked.map((p) => (
              <PlaylistCard key={`${p.uid}-${p.kind}`} playlist={p} />
            ))}
          </div>
        ) : (
          <div className="empty-hint">{t.library.noLikedPlaylists}</div>
        )}
      </Section>
    </>
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

export function Library({ tab = 'playlists' }: { tab?: LibraryTab }) {
  const t = useT();
  if (tab === 'tracks') {
    return (
      <div className="page">
        <h1 className="page-title">
          <Heart size={26} /> {t.common.liked}
        </h1>
        <LikedTracks />
      </div>
    );
  }
  return (
    <div className="page">
      <h1 className="page-title">
        <LibraryIcon size={26} /> {t.nav.library}
      </h1>
      <div className="tabs big">
        {TABS.map((id) => (
          <button key={id} className={cx('tab', id === tab && 'active')} onClick={() => navigate({ name: 'library', tab: id })}>
            {t.common[id]}
          </button>
        ))}
        {/* The iPhone's tab bar has no Downloads tab: it is one of the Collection's. */}
        {isIos && offline && (
          <button className={cx('tab', tab === 'downloads' && 'active')} onClick={() => navigate({ name: 'library', tab: 'downloads' })} data-testid="tab-downloads">
            {t.nav.downloads}
          </button>
        )}
      </div>
      {tab === 'playlists' && <Playlists />}
      {tab === 'albums' && <Albums />}
      {tab === 'artists' && <Artists />}
      {tab === 'downloads' && <DownloadsView embedded />}
    </div>
  );
}
