import { HardDriveDownload, Shuffle } from 'lucide-react';
import { ListPlayButton } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { offline, playShuffled, playTracks } from '../player/player.ts';
import { formatSize, useOfflineVersion } from '../ui/offline.ts';
import { fmtTotal } from '../ui/util.ts';

/** Downloaded tracks: what plays without a network. `embedded`: a Collection tab on the iPhone,
 * laid out like Liked Songs (an action row and the list) under the Collection's own tabs. */
export function DownloadsView({ embedded }: { embedded?: boolean }) {
  const t = useT();
  const s = t.downloads;
  useOfflineVersion((v) => v.v);
  const entries = offline?.entries() ?? [];
  const tracks = entries.map((e) => e.track);
  const total = tracks.reduce((n, x) => n + (x.durationMs || 0), 0);
  const extra = { list: 'downloads' };
  const play = () => playTracks(tracks, 0, t.nav.downloads, undefined, extra);
  const shuffle = () => playShuffled(tracks, t.nav.downloads, undefined, extra);
  const playButton = <ListPlayButton list={extra.list} onPlay={play} disabled={!tracks.length} testId="downloads-play" />;
  const list = tracks.length ? (
    <TrackList tracks={tracks} onPlay={(i) => playTracks(tracks, i, t.nav.downloads, undefined, extra)} />
  ) : (
    <div className="empty-hint" data-testid="downloads-empty">
      {s.empty}
    </div>
  );
  if (embedded)
    return (
      <>
        <div className="lib-actions">
          {playButton}
          <button className="btn glass-btn" onClick={shuffle} disabled={!tracks.length} title={t.common.shuffle}>
            <Shuffle size={16} /> {t.common.shuffle}
          </button>
          <span className="muted">
            {t.count.tracks(tracks.length)}
            {tracks.length > 0 && ` · ${formatSize(offline?.totalSize() ?? 0)}`}
          </span>
        </div>
        {list}
      </>
    );
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
            {playButton}
            <button className="btn glass-btn" onClick={shuffle} disabled={!tracks.length}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
          </div>
        </div>
      </header>
      {list}
    </div>
  );
}
