import { api } from '../api/client.ts';
import { AlbumCard, ErrorBox, PlaylistCard, Section, Shelf, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { WaveHero } from '../components/Wave.tsx';
import { useT } from '../i18n.ts';
import { playTracks } from '../player/player.ts';
import { isOwn, navigate, useApp } from '../store.ts';
import { useAsync } from '../ui/util.ts';

async function playAlbum(id: number) {
  const a = await api.album(id);
  playTracks((a.volumes || []).flat(), 0, a.title);
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
      <div className="greeting">
        {greeting}
        {account ? `, ${account.displayName}` : ''}
      </div>
      <WaveHero />

      {playlists.length > 0 && (
        <Section title={t.home.yourPlaylists}>
          <Shelf>
            {playlists.map((p) => (
              <PlaylistCard key={p.kind} playlist={p} onPlay={async () => {
                const full = await api.playlist(p.uid, p.kind);
                playTracks((full.tracks || []).map((x) => x.track!).filter(Boolean), 0, p.title);
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
