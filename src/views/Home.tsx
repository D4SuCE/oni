import { RefreshCw, Search, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../api/client.ts';
import { MixCard, useGenreTitles } from '../components/Mixes.tsx';
import { loadRecs, useRecs } from '../recs/index.ts';
import { AlbumCard, ErrorBox, PlaylistCard, Section, Shelf, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { WaveHero } from '../components/Wave.tsx';
import { useT } from '../i18n.ts';
import { playTracks } from '../player/player.ts';
import { isOwn, navigate, useApp } from '../store.ts';
import { isIos } from '../ui/platform.ts';
import { useAsync } from '../ui/util.ts';

async function playAlbum(id: number) {
  const a = await api.album(id);
  playTracks((a.volumes || []).flat(), 0, a.title, { album: a.id });
}

function ForYou() {
  const t = useT();
  const ready = useApp((s) => s.libraryReady);
  const { status, mixes, personal } = useRecs();
  const genres = useGenreTitles();
  useEffect(() => {
    if (ready) loadRecs();
  }, [ready]);
  return (
    <>
      <Section
        title={t.recs.forYou}
        action={
          status === 'ready' && (
            <button className="btn ghost small" onClick={() => loadRecs(true)} title={t.recs.refresh}>
              <RefreshCw size={13} /> {t.recs.refresh}
            </button>
          )
        }
      >
        {status === 'loading' || status === 'idle' ? (
          <Spinner label={t.recs.building} />
        ) : !mixes.length ? (
          <div className="empty-hint">{t.recs.notEnough}</div>
        ) : (
          <Shelf>
            {mixes.map((m) => (
              <MixCard key={m.id} mix={m} genres={genres} />
            ))}
          </Shelf>
        )}
      </Section>
      {personal.length > 0 && (
        <Section title={t.recs.byYandex}>
          <Shelf>
            {personal.map((p) => (
              <PlaylistCard
                key={`${p.uid}-${p.kind}`}
                playlist={p}
                onPlay={async () => {
                  const full = await api.playlist(p.uid, p.kind);
                  playTracks((full.tracks || []).map((x) => x.track!).filter(Boolean), 0, p.title, { playlist: `${p.uid}:${p.kind}` });
                }}
              />
            ))}
          </Shelf>
        </Section>
      )}
    </>
  );
}

export function Home() {
  const account = useApp((s) => s.account);
  const playlists = useApp((s) => s.playlists).filter((p) => isOwn(p));
  const releases = useAsync(() => api.newReleases(18), []);
  const chart = useAsync(() => api.chart(), []);
  const t = useT();
  const greeting = t.home.greeting(new Date().getHours());

  return (
    <div className="page">
      {/* On the iPhone the tab bar keeps four tabs: search and settings live up here, as in
          Yandex's app (src/components/Sidebar.tsx hides them below). */}
      <div className="home-top">
        <div className="greeting">
          {greeting}
          {account ? `, ${account.displayName}` : ''}
        </div>
        {isIos && (
          <>
            <button className="icon-btn" onClick={() => navigate({ name: 'search' })} title={t.nav.search} data-testid="top-search">
              <Search size={21} />
            </button>
            <button className="icon-btn" onClick={() => navigate({ name: 'settings' })} title={t.nav.settings} data-testid="top-settings">
              <Settings size={21} />
            </button>
          </>
        )}
      </div>
      <WaveHero />
      <ForYou />

      {playlists.length > 0 && (
        <Section title={t.home.yourPlaylists}>
          <Shelf>
            {playlists.map((p) => (
              <PlaylistCard key={p.kind} playlist={p} onPlay={async () => {
                const full = await api.playlist(p.uid, p.kind);
                playTracks((full.tracks || []).map((x) => x.track!).filter(Boolean), 0, p.title, { playlist: `${p.uid}:${p.kind}` });
              }} />
            ))}
          </Shelf>
        </Section>
      )}

      <Section title={t.home.newReleases}>
        {releases.loading ? <Spinner /> : releases.error ? <ErrorBox error={releases.error} onRetry={releases.reload} /> : (
          <Shelf>
            {releases.data!.map((a) => (
              <AlbumCard key={a.id} album={a} onPlay={() => playAlbum(a.id)} />
            ))}
          </Shelf>
        )}
      </Section>

      <Section title={t.home.chart} action={<button className="btn ghost small" onClick={() => navigate({ name: 'search' })}>{t.home.findYours}</button>}>
        {chart.loading ? <Spinner /> : chart.error ? <ErrorBox error={chart.error} onRetry={chart.reload} /> : (
          <TrackList tracks={chart.data!.slice(0, 20)} onPlay={(i) => playTracks(chart.data!, i, t.home.chart)} />
        )}
      </Section>
    </div>
  );
}
