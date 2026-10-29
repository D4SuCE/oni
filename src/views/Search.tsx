import { Search as SearchIcon, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { Album, Artist, Playlist, SearchResult, Track } from '../api/types.ts';
import { artistCover, coverUrl, playlistCover, trackCover } from '../api/yandex.ts';
import { AlbumCard, ArtistCard, Cover, ErrorBox, PlaylistCard, Section, Shelf, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { playTracks } from '../player/player.ts';
import { back, navigate, useApp } from '../store.ts';
import { type OniLink, linkFrom } from '../ui/links.ts';
import { isIos } from '../ui/platform.ts';
import { useSwipeDown } from '../ui/swipe.ts';
import { cx, useEscape } from '../ui/util.ts';

/** A link pasted into Search, found as a search would find it: what it points to on top, its tracks
 * below (an album's, an artist's best, a playlist's), and the name to play them under. Nothing plays
 * by itself (the user: a paste should look like a search, not start music out of nowhere). */
async function findLink(link: OniLink): Promise<{ result: SearchResult; title: string }> {
  const one = <T,>(x: T) => ({ results: [x], total: 1 });
  if (link.kind === 'playlist') {
    const p = await api.playlist(link.owner, link.id);
    const tracks = (p.tracks || []).map((i) => i.track).filter((t): t is Track => Boolean(t));
    return { result: { best: { type: 'playlist', result: p }, tracks: { results: tracks, total: tracks.length } }, title: p.title };
  }
  if (link.kind === 'track') {
    const [t] = await api.tracks([link.id]);
    return { result: t ? { best: { type: 'track', result: t }, tracks: one(t) } : {}, title: t?.title ?? '' };
  }
  if (link.kind === 'album') {
    const a = await api.album(link.id);
    const tracks = (a.volumes || []).flat();
    return { result: { best: { type: 'album', result: a }, tracks: { results: tracks, total: tracks.length } }, title: a.title };
  }
  const { artist, popularTracks } = await api.artist(link.id);
  return { result: { best: { type: 'artist', result: artist }, tracks: { results: popularTracks || [], total: popularTracks?.length || 0 } }, title: artist.name };
}

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
  // The latest answer and the query it is for; the previous results stay up while the next ones load.
  // `title`: a pasted link's own name, which its tracks play under (not "Search: https://…").
  const [answer, setAnswer] = useState<{ q: string; result?: SearchResult; error?: unknown; title?: string } | null>(null);
  const q = query.trim();
  const result = q ? (answer?.result ?? null) : null;
  const error = q ? answer?.error : null;
  const loading = Boolean(q) && answer?.q !== q;
  const input = useRef<HTMLInputElement>(null);
  // On the iPhone an empty search (opened by mistake, or given up) goes away with a swipe down.
  const page = useRef<HTMLDivElement>(null);
  const swipeAway = isIos && !q;
  const leave = useCallback(() => {
    input.current?.blur();
    back();
  }, []);
  useSwipeDown(page, leave, undefined, swipeAway);
  // Escape leaves the search, back to where it was opened from.
  useEscape(leave);
  const t = useT();

  // A fresh search starts typing; with a query already there (back to the page, or a shortcut's
  // oni://search link) the results come first, and on a phone the keyboard would cover them.
  useEffect(() => {
    if (!useApp.getState().searchQuery.trim()) input.current?.focus();
  }, []);

  useEffect(() => {
    if (!q) return;
    const link = linkFrom(q);
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        // A link pasted in (Oni's or Yandex Music's): what it points to, found and shown.
        if (link) {
          const { result, title } = await findLink(link);
          if (alive) setAnswer({ q, result, title });
          return;
        }
        const r = await api.search(q);
        if (alive) setAnswer({ q, result: r });
      } catch (e) {
        if (alive) setAnswer((prev) => ({ q, result: prev?.result, error: e }));
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const tracks = result?.tracks?.results || [];
  return (
    <div ref={page} className={cx('page', swipeAway && 'swipe-away')}>
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
              <TrackList tracks={tracks} onPlay={(i) => (answer?.title ? playTracks(tracks, i, answer.title) : playTracks(tracks, i, t.search.source(query), undefined, { label: { key: 'search', arg: query } }))} />
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
          {!result.best && !tracks.length && !result.artists?.results.length && !result.albums?.results.length && !result.playlists?.results.length && <div className="empty-hint">{t.search.nothing}</div>}
        </>
      )}
    </div>
  );
}
