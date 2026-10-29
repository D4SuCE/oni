import { Play, Radio, Share, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { artistCover } from '../api/yandex.ts';
import { AlbumCard, ArtistCard, ErrorBox, PageHeader, Section, Shelf, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useLang, useT } from '../i18n.ts';
import { playRadio, playShuffled, playTracks } from '../player/player.ts';
import { share } from '../ui/share.ts';
import { useAsync } from '../ui/util.ts';

export function ArtistView({ id }: { id: number | string }) {
  const { data, loading, error, reload } = useAsync(() => api.artist(id), [id]);
  const [showAll, setShowAll] = useState(false);
  const t = useT();
  const lang = useLang((s) => s.lang);
  const genres = useAsync(() => api.genreTitles(), [lang]);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { artist, popularTracks, albums, alsoAlbums, similarArtists } = data;
  const tracks = popularTracks || [];
  const playAll = async (shuffle: boolean) => {
    const all = await api.artistTracks(id, 0, 100).catch(() => tracks);
    shuffle ? playShuffled(all, artist.name) : playTracks(all, 0, artist.name);
  };
  return (
    <div className="page">
      <PageHeader
        cover={artistCover(artist, 600)}
        round
        icon="user"
        kicker={t.common.artist}
        title={artist.name}
        meta={artist.genres?.length ? artist.genres.map((g) => genres.data?.[g] || g).join(', ') : undefined}
        actions={
          <>
            <button className="btn primary" onClick={() => playAll(false)}>
              <Play size={16} fill="currentColor" /> {t.common.play}
            </button>
            <button className="btn glass-btn" onClick={() => playAll(true)}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
            <button className="btn glass-btn" onClick={() => playRadio(`artist:${artist.id}`, artist.name)} data-testid="radio">
              <Radio size={16} /> {t.common.radio}
            </button>
            <button className="btn glass-btn" onClick={() => share({ kind: 'artist', id: String(artist.id) }, artist.name)} title={t.menu.share} data-testid="share">
              <Share size={16} /> {t.menu.share}
            </button>
          </>
        }
      />
      {tracks.length > 0 && (
        <Section
          title={t.artist.popular}
          action={
            tracks.length > 5 && (
              <button className="btn ghost small" onClick={() => setShowAll(!showAll)}>
                {showAll ? t.artist.showLess : t.artist.showAll}
              </button>
            )
          }
        >
          <TrackList tracks={showAll ? tracks : tracks.slice(0, 5)} onPlay={(i) => playTracks(tracks, i, artist.name)} />
        </Section>
      )}
      {albums?.length > 0 && (
        <Section title={t.common.albums}>
          <Shelf>
            {albums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Shelf>
        </Section>
      )}
      {!!alsoAlbums?.length && (
        <Section title={t.artist.appearsOn}>
          <Shelf>
            {alsoAlbums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Shelf>
        </Section>
      )}
      {similarArtists?.length > 0 && (
        <Section title={t.artist.similar}>
          <Shelf>
            {similarArtists.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </Shelf>
        </Section>
      )}
    </div>
  );
}
