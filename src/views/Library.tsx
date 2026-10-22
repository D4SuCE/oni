import { Heart, Library as LibraryIcon, MoreHorizontal, Plus, Radio, Shuffle } from 'lucide-react';
import { openMenu } from '../components/Menu.tsx';
import { isIos } from '../ui/platform.ts';
import { DownloadButton } from '../components/DownloadButton.tsx';
import { DownloadsView } from './Downloads.tsx';
import { useEffect, useState } from 'react';
import { moved } from '../ui/dragSort.ts';
import { api } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { AlbumCard, ArtistCard, ErrorBox, ListPlayButton, PlaylistCard, Section, Spinner } from '../components/Common.tsx';
import { askText } from '../components/Dialog.tsx';
import { SmartShuffleButton } from '../components/SmartShuffle.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { offline, playRadio, playShuffled, playTracks } from '../player/player.ts';
import { createPlaylist, errorText, navigate, refreshLibrary, toast, type LibraryTab, useApp } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';
import { useListSearch } from '../components/ListSearch.tsx';
import { savedList, useKeepForOffline } from '../ui/offline.ts';
import { ApiError, trackKey } from '../api/yandex.ts';

/** "tracks" (liked songs) is its own page, reached from the sidebar or the Liked Songs card. */
const TABS = ['playlists', 'albums', 'artists'] as const;

const FIRST_PAGE = 100;


/**
 * Liked in an order of one's own, kept by Yandex (the user: synced to the other devices). Yandex
 * keeps likes newest first and refuses to move one, but liking a liked track again puts it on top,
 * and one call with several puts them on top in the order given (both found by trying). So a track
 * moved to `to` is one call: the new list's first `to + 1` liked again, top first; the rest keep
 * their order below. Yandex's own app shows the same order.
 */
async function moveLiked(tracks: Track[], from: number, to: number) {
  const next = moved(tracks, from, to);
  await api.setLiked(next.slice(0, to + 1).map(trackKey), true);
  return next;
}

function LikedTracks() {
  const keys = useApp((s) => s.likedKeys);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const t = useT();
  // Liked tracks are the account's playlist number 3.
  const uid = useApp((s) => s.account?.uid);
  const from = { playlist: `${uid}:3` };

  const offlineNow = useApp((s) => s.offline);
  useEffect(() => {
    let alive = true;
    // With no network: Liked as kept when last seen; its downloaded tracks play in its order.
    const kept = savedList('liked')?.tracks;
    if (offlineNow) {
      if (kept) setTracks(kept);
      else setError(new Error(t.downloads.notSaved));
      return;
    }
    // Seen before: the kept list shows at once, its Download button with it (the user: it came up
    // late, after the rest of the list), and the fresh one replaces it when it is in.
    const byId = new Map((kept ?? []).map((x) => [String(x.id), x]));
    const quick = keys.map((k) => byId.get(k.split(':')[0])).filter((x): x is Track => Boolean(x));
    const shown = quick.length === keys.length && keys.length > 0;
    if (shown) setTracks(quick);
    (async () => {
      try {
        const first = await api.tracks(keys.slice(0, FIRST_PAGE));
        if (!alive) return;
        if (!shown) setTracks(first);
        if (keys.length > FIRST_PAGE) {
          const rest = await api.tracks(keys.slice(FIRST_PAGE));
          if (alive) setTracks([...first, ...rest]);
        } else if (shown) setTracks(first);
      } catch (e) {
        if (!alive || shown) return;
        if (kept && !(e instanceof ApiError)) setTracks(kept);
        else setError(e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, offlineNow]);

  const search = useListSearch();
  // Kept whole only: the first page alone is not Liked.
  useKeepForOffline('liked', t.common.liked, tracks && tracks.length >= keys.length ? tracks : null);
  const radio = () => playRadio(`playlist:${from.playlist}`, t.common.liked);
  if (error) return <ErrorBox error={error} />;
  if (!tracks) return <Spinner label={t.library.loadingLikes} />;
  return (
    <>
      <div className="lib-actions">
        <ListPlayButton list={`playlist:${from.playlist}`} onPlay={() => playTracks(tracks, 0, t.common.liked, from)} disabled={!tracks.length} />
        <button className="btn glass-btn" onClick={() => playShuffled(tracks, t.common.liked, from)} disabled={!tracks.length}>
          <Shuffle size={16} /> {t.common.shuffle}
        </button>
        <SmartShuffleButton tracks={tracks} title={t.common.liked} from={from} />
        {/* Only the whole list: the first page alone would download the newest hundred. */}
        {tracks.length >= keys.length && <DownloadButton listKey="liked" tracks={tracks} title={t.common.liked} />}
        {tracks.length > 0 && search.button}
        {/* Radio by the liked tracks, as a playlist's (the user: playlists had it, Liked did not);
            on the iPhone in "…", as on a playlist's page. */}
        {tracks.length > 0 &&
          (isIos ? (
            <button className="btn glass-btn" onClick={(e) => openMenu(e, [{ label: t.common.radio, icon: <Radio size={15} />, onClick: radio }])} title={t.common.more} data-testid="liked-more">
              <MoreHorizontal size={18} />
            </button>
          ) : (
            <button className="btn glass-btn" onClick={radio} data-testid="radio">
              <Radio size={16} /> {t.common.radio}
            </button>
          ))}
        <span className="muted">{t.count.tracks(keys.length)}</span>
      </div>
      {search.field}
      {tracks.length ? (
        <TrackList
          tracks={tracks}
          filter={search.query}
          onPlay={(i) => playTracks(tracks, i, t.common.liked, from)}
          onMove={
            tracks.length >= keys.length
              ? async (a, b) => {
                  // In the new order at once, while Yandex is told; then the library from Yandex.
                  setTracks(moved(tracks, a, b));
                  try {
                    await moveLiked(tracks, a, b);
                  } catch (e) {
                    toast(t.playlist.moveFailed(errorText(e)));
                  }
                  refreshLibrary();
                }
              : undefined
          }
        />
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
