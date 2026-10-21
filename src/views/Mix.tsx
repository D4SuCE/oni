import { Play, Shuffle } from 'lucide-react';
import { MixArt, mixSubtitle, mixTitle, useGenreTitles } from '../components/Mixes.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useLang, useT } from '../i18n.ts';
import { playShuffled, playTracks } from '../player/player.ts';
import { useRecs } from '../recs/index.ts';
import { fmtTotal } from '../ui/util.ts';

export function MixView({ id }: { id: string }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const mix = useRecs((s) => s.mixes.find((m) => m.id === id));
  const genres = useGenreTitles();
  if (!mix) return <div className="empty-hint">{t.recs.gone}</div>;
  const title = mixTitle(mix, genres);
  const extra = { origin: mix.kind };
  const total = mix.tracks.reduce((s, x) => s + (x.durationMs || 0), 0);
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-cover mix-cover">
          <MixArt mix={mix} title={title} big />
        </div>
        <div className="page-header-text">
          <div className="kicker">{t.recs.kicker[mix.kind]}</div>
          <h1 title={title}>{title}</h1>
          <div className="page-meta">
            {mixSubtitle(mix, genres)} · {t.count.tracks(mix.tracks.length)}, {fmtTotal(total)}
            <div className="muted desc">
              {t.recs.refreshes[mix.kind]}
              {mix.slotEnd ? ` · ${t.recs.until(new Date(mix.slotEnd).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }))}` : ''}
            </div>
          </div>
          <div className="page-actions">
            <button className="btn primary" onClick={() => playTracks(mix.tracks, 0, title, undefined, extra)} data-testid="mix-play">
              <Play size={16} fill="currentColor" /> {t.common.play}
            </button>
            <button className="btn glass-btn" onClick={() => playShuffled(mix.tracks, title, undefined, extra)}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
          </div>
        </div>
      </header>
      <TrackList tracks={mix.tracks} onPlay={(i) => playTracks(mix.tracks, i, title, undefined, extra)} />
    </div>
  );
}
