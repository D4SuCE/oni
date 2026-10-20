import { Play, Radio, Shuffle } from 'lucide-react';
import { api } from '../api/client.ts';
import { coverUrl } from '../api/yandex.ts';
import { ArtistLinks, ErrorBox, PageHeader, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { playRadio, playShuffled, playTracks } from '../player/player.ts';
import { fmtTotal, useAsync } from '../ui/util.ts';

export function AlbumView({ id }: { id: number | string }) {
  const { data: album, loading, error, reload } = useAsync(() => api.album(id), [id]);
  const t = useT();
  if (loading) return <Spinner />;
  if (error || !album) return <ErrorBox error={error} onRetry={reload} />;
  const tracks = (album.volumes || []).flat();
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
            <button className="btn primary" onClick={() => playTracks(tracks, 0, album.title)}>
              <Play size={16} fill="currentColor" /> {t.common.play}
            </button>
            <button className="btn glass-btn" onClick={() => playShuffled(tracks, album.title)}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
            <button className="btn glass-btn" onClick={() => playRadio(`album:${album.id}`, album.title)} data-testid="radio">
              <Radio size={16} /> {t.common.radio}
            </button>
          </>
        }
      />
      <TrackList tracks={tracks} showAlbum={false} onPlay={(i) => playTracks(tracks, i, album.title)} />
    </div>
  );
}
