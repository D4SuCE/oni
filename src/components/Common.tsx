import { useState, type ReactNode } from 'react';
import { Disc3, Loader2, Music2, Pause, Play, User } from 'lucide-react';
import type { Album, Artist, Playlist } from '../api/types.ts';
import { artistCover, coverUrl, playlistCover } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { listKeyOf, toggle, usePlayer } from '../player/player.ts';
import { isOwn, navigate } from '../store.ts';
import { cx } from '../ui/util.ts';

export function Cover({ src, size, round, icon = 'music', className, onClick }: { src?: string; size?: number; round?: boolean; icon?: 'music' | 'user' | 'disc'; className?: string; onClick?: () => void }) {
  // Failed for this address only: the kept cover that takes over with no network shows.
  const [failedSrc, setFailedSrc] = useState<string>();
  const failed = Boolean(src) && failedSrc === src;
  const Icon = icon === 'user' ? User : icon === 'disc' ? Disc3 : Music2;
  const style = size ? { width: size, height: size } : undefined;
  return (
    <div className={cx('cover', round && 'round', className)} style={style} onClick={onClick}>
      {src && !failed ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailedSrc(src)} /> : <Icon className="cover-icon" />}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner">
      <Loader2 className="spin" size={22} />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="error-box">
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          {t.common.retry}
        </button>
      )}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Shelf({ children }: { children: ReactNode }) {
  return <div className="shelf">{children}</div>;
}

function Card({ cover, title, subtitle, round, icon, onOpen, onPlay }: { cover?: string; title: string; subtitle?: string; round?: boolean; icon?: 'music' | 'user' | 'disc'; onOpen: () => void; onPlay?: () => void }) {
  const t = useT();
  return (
    <div className="card" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="card-cover">
        <Cover src={cover} round={round} icon={icon} />
        {onPlay && (
          <button
            className="card-play"
            title={t.common.play}
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
          >
            <Play size={18} fill="currentColor" />
          </button>
        )}
      </div>
      <div className="card-title" title={title}>
        {title}
      </div>
      {subtitle && <div className="card-sub">{subtitle}</div>}
    </div>
  );
}

export function AlbumCard({ album, onPlay }: { album: Album; onPlay?: () => void }) {
  const sub = [album.year, album.artists?.map((a) => a.name).join(', ')].filter(Boolean).join(' · ');
  return <Card cover={coverUrl(album.coverUri, 300)} title={album.title} subtitle={sub} icon="disc" onOpen={() => navigate({ name: 'album', id: album.id })} onPlay={onPlay} />;
}

export function PlaylistCard({ playlist, onPlay }: { playlist: Playlist; onPlay?: () => void }) {
  const t = useT();
  return (
    <Card
      cover={playlistCover(playlist, 300)}
      title={playlist.title}
      subtitle={isOwn(playlist) ? t.count.tracksShort(playlist.trackCount) : `${playlist.owner?.name || playlist.owner?.login || ''} · ${t.count.tracksShort(playlist.trackCount)}`}
      onOpen={() => navigate({ name: 'playlist', uid: playlist.uid, kind: playlist.kind })}
      onPlay={onPlay}
    />
  );
}

export function ArtistCard({ artist }: { artist: Artist }) {
  const t = useT();
  return <Card cover={artistCover(artist, 300)} title={artist.name} subtitle={t.common.artist} round icon="user" onOpen={() => navigate({ name: 'artist', id: artist.id })} />;
}

/** Artists as links to their pages; `plain` when there is nowhere to go (an uploaded file's
 * artist has no page) or a tap must stay with the row (track lists on a phone). */
export function ArtistLinks({ artists, plain }: { artists?: Artist[]; plain?: boolean }) {
  if (plain) return <>{(artists || []).map((a) => a.name).join(', ')}</>;
  return (
    <>
      {(artists || []).map((a, i) => (
        <span key={`${a.id}-${i}`}>
          {i > 0 && ', '}
          <a
            className="link"
            onClick={(e) => {
              e.stopPropagation();
              if (!a.various) navigate({ name: 'artist', id: a.id });
            }}
          >
            {a.name}
          </a>
        </span>
      ))}
    </>
  );
}

export function PageHeader({ cover, round, kicker, title, meta, actions, icon }: { cover?: string; round?: boolean; kicker: string; title: string; meta?: ReactNode; actions?: ReactNode; icon?: 'music' | 'user' | 'disc' }) {
  return (
    <header className="page-header">
      <Cover src={cover} round={round} icon={icon} className="page-cover" />
      <div className="page-header-text">
        <div className="kicker">{kicker}</div>
        <h1 title={title}>{title}</h1>
        {meta && <div className="page-meta">{meta}</div>}
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

/** "Play" on a list's page. While that list plays it is "Pause", and "Resume" when paused, as in
 * Yandex's app: pressed then, it pauses or goes on instead of starting the list over. */
export function ListPlayButton({ list, onPlay, disabled, testId }: { list: string; onPlay: () => void; disabled?: boolean; testId?: string }) {
  const t = useT();
  const mine = usePlayer((s) => s.index >= 0 && listKeyOf(s.source) === list);
  const playing = usePlayer((s) => s.playing);
  const active = mine && playing;
  return (
    <button className="btn primary" onClick={() => (mine ? toggle() : onPlay())} disabled={disabled} data-testid={testId ?? 'list-play'} data-playing={active || undefined}>
      {active ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />} {active ? t.player.pause : mine ? t.wave.resume : t.common.play}
    </button>
  );
}
