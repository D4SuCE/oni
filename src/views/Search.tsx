import { Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { Album, Artist, Playlist, SearchResult, Track } from '../api/types.ts';
import { artistCover, coverUrl, playlistCover, trackCover } from '../api/yandex.ts';
import { AlbumCard, ArtistCard, Cover, ErrorBox, PlaylistCard, Section, Shelf, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { playTracks } from '../player/player.ts';
import { navigate, useApp } from '../store.ts';

function BestResult({ best }: { best: NonNullable<SearchResult['best']> }) {
  const r = best.result as any;
  const tx = useT();
  let cover: string | undefined;
  let title = '';
  let kind = '';
  let open = () => {};
  let round = false;
  if (best.type === 'track') {
    const t = r as Track;
    cover = trackCover(t, 300);
    title = t.title;
    kind = tx.search.track(t.artists.map((a) => a.name).join(', '));
    open = () => playTracks([t], 0, t.title);
  } else if (best.type === 'artist') {
    const a = r as Artist;
    cover = artistCover(a, 300);
    title = a.name;
    kind = tx.common.artist;
    round = true;
    open = () => navigate({ name: 'artist', id: a.id });
  } else if (best.type === 'album') {
    const a = r as Album;
    cover = coverUrl(a.coverUri, 300);
    title = a.title;
    kind = tx.search.album(a.artists.map((x) => x.name).join(', '));
    open = () => navigate({ name: 'album', id: a.id });
  } else if (best.type === 'playlist') {
    const p = r as Playlist;
    cover = playlistCover(p, 300);
    title = p.title;
    kind = tx.common.playlist;
    open = () => navigate({ name: 'playlist', uid: p.uid, kind: p.kind });
  } else return null;
  return (
    <button className="best glass" onClick={open}>
      <Cover src={cover} size={120} round={round} />
      <div>
        <div className="kicker">{tx.search.best}</div>
        <div className="best-title">{title}</div>
        <div className="muted">{kind}</div>
      </div>
    </button>
  );
}

export function Search() {
  const query = useApp((s) => s.searchQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResult(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api.search(q);
        if (alive) (setResult(r), setError(null));
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const tracks = result?.tracks?.results || [];
  return (
    <div className="page">
      <div className="search-box glass">
        <SearchIcon size={20} />
        <input
          ref={input}
          value={query}
          placeholder={t.search.placeholder}
          onChange={(e) => useApp.setState({ searchQuery: e.target.value })}
          data-testid="search-input"
        />
        {query && (
          <button className="icon-btn" onClick={() => useApp.setState({ searchQuery: '' })} title={t.common.clear}>
            <X size={18} />
          </button>
        )}
      </div>

      {loading && !result && <Spinner />}
      {error ? <ErrorBox error={error} /> : null}
      {!query && <div className="empty-hint">{t.search.start}</div>}

      {result && (
        <>
          {result.best && <BestResult best={result.best} />}
          {tracks.length > 0 && (
            <Section title={t.common.tracks}>
              <TrackList tracks={tracks} onPlay={(i) => playTracks(tracks, i, t.search.source(query))} />
            </Section>
          )}
          {!!result.artists?.results.length && (
            <Section title={t.common.artists}>
              <Shelf>
                {result.artists.results.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </Shelf>
            </Section>
          )}
          {!!result.albums?.results.length && (
            <Section title={t.common.albums}>
              <Shelf>
                {result.albums.results.map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </Shelf>
            </Section>
          )}
          {!!result.playlists?.results.length && (
            <Section title={t.common.playlists}>
              <Shelf>
                {result.playlists.results.map((p) => (
                  <PlaylistCard key={`${p.uid}-${p.kind}`} playlist={p} />
                ))}
              </Shelf>
            </Section>
          )}
          {!tracks.length && !result.artists?.results.length && !result.albums?.results.length && <div className="empty-hint">{t.search.nothing}</div>}
        </>
      )}
    </div>
  );
}
