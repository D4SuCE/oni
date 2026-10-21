import { HardDriveDownload, Play, Shuffle } from 'lucide-react';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { offline, playShuffled, playTracks } from '../player/player.ts';
import { formatSize, useOfflineVersion } from '../ui/offline.ts';
import { fmtTotal } from '../ui/util.ts';

/** Downloaded tracks: what plays without a network. */
export function DownloadsView() {
  const t = useT();
  const s = t.downloads;
  useOfflineVersion((v) => v.v);
  const entries = offline?.entries() ?? [];
  const tracks = entries.map((e) => e.track);
  const total = tracks.reduce((n, x) => n + (x.durationMs || 0), 0);
  return (
    <div className="page">
      <header className="page-header">
        <div className="page-cover downloads-cover">
          <HardDriveDownload size={64} strokeWidth={1.4} />
        </div>
        <div className="page-header-text">
          <div className="kicker">{s.kicker}</div>
          <h1>{t.nav.downloads}</h1>
          <div className="page-meta">
            {t.count.tracks(tracks.length)}
            {tracks.length > 0 && `, ${fmtTotal(total)} · ${formatSize(offline?.totalSize() ?? 0)}`}
          </div>
          <div className="page-actions">
            <button className="btn primary" onClick={() => playTracks(tracks, 0, t.nav.downloads)} disabled={!tracks.length} data-testid="downloads-play">
              <Play size={16} fill="currentColor" /> {t.common.play}
            </button>
            <button className="btn glass-btn" onClick={() => playShuffled(tracks, t.nav.downloads)} disabled={!tracks.length}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
          </div>
        </div>
      </header>
      {tracks.length ? (
        <TrackList tracks={tracks} onPlay={(i) => playTracks(tracks, i, t.nav.downloads)} />
      ) : (
        <div className="empty-hint" data-testid="downloads-empty">
          {s.empty}
        </div>
      )}
    </div>
  );
}
