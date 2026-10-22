import { Radio, Shuffle } from 'lucide-react';
import { DownloadButton } from '../components/DownloadButton.tsx';
import { api } from '../api/client.ts';
import { coverUrl } from '../api/yandex.ts';
import { ArtistLinks, ErrorBox, ListPlayButton, PageHeader, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { playRadio, playShuffled, playTracks } from '../player/player.ts';
import { fmtTotal, useAsync } from '../ui/util.ts';
import { useMemo } from 'react';
import { useApp } from '../store.ts';
import { savedList } from '../player/offlineLists.ts';
import { loadOrKept, useKeepForOffline } from '../ui/offline.ts';
import type { Album } from '../api/types.ts';

export function AlbumView({ id }: { id: number | string }) {
  // With no network: the album as kept when last seen, if some of it is downloaded.
  const offlineNow = useApp((s) => s.offline);
  const key = `album:${id}`;
  const { data: album, loading, error, reload } = useAsync(() => loadOrKept(() => api.album(id), () => keptAlbum(key)), [id, offlineNow]);
  const t = useT();
  const tracks = useMemo(() => (album?.volumes || []).flat(), [album]);
  useKeepForOffline(key, album?.title ?? '', album ? tracks : null, album ?? undefined);
  if (loading) return <Spinner />;
  if (error || !album) return <ErrorBox error={error} onRetry={reload} />;
  const from = { album: album.id };
  const total = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);
  const kind = album.type === 'single' ? t.common.single : album.type === 'compilation' ? t.common.compilation : t.common.album;
  return (
    <div className="page">
      <PageHeader
        cover={coverUrl(album.coverUri, 600)}
        icon="disc"
        kicker={kind}
        title={album.title + (album.version ? ` (${album.version})` : '')}
        meta={
          <>
            <ArtistLinks artists={album.artists} />
            {album.year && <span> · {album.year}</span>}
            <span> · {t.count.tracks(tracks.length)}, {fmtTotal(total)}</span>
          </>
        }
        actions={
          <>
            <ListPlayButton list={`album:${album.id}`} onPlay={() => playTracks(tracks, 0, album.title, from)} />
            <button className="btn glass-btn" onClick={() => playShuffled(tracks, album.title, from)}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
            <button className="btn glass-btn" onClick={() => playRadio(`album:${album.id}`, album.title)} data-testid="radio">
              <Radio size={16} /> {t.common.radio}
            </button>
            <DownloadButton listKey={`album:${album.id}`} tracks={tracks} />
          </>
        }
      />
      <TrackList tracks={tracks} showAlbum={false} onPlay={(i) => playTracks(tracks, i, album.title, from)} />
    </div>
  );
}

/** The album as kept for the offline mode (its header and its tracks in one volume). */
function keptAlbum(key: string): Album | null {
  const l = savedList(key);
  return l?.header ? ({ ...(l.header as Album), volumes: [l.tracks] } as Album) : null;
}
