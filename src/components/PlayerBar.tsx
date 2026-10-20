import { Ban, Heart, ListMusic, Loader2, Maximize2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX, Waves } from 'lucide-react';
import { useRef } from 'react';
import type { Track } from '../api/types.ts';
import { trackCover } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { cycleRepeat, next, prev, seek, setVolume, toggle, toggleShuffle, usePlayer } from '../player/player.ts';
import { dislike, toggleLike, useApp } from '../store.ts';
import { cx, fmtTime } from '../ui/util.ts';
import { ArtistLinks, Cover } from './Common.tsx';

export function SeekBar({ className }: { className?: string }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const p = duration ? (position / duration) * 100 : 0;
  const t = useT();
  return (
    <div className={cx('seek', className)}>
      <span className="time">{fmtTime(position)}</span>
      <input
        type="range"
        className="range"
        min={0}
        max={duration || 1}
        step={0.5}
        value={position}
        style={{ '--p': `${p}%` } as React.CSSProperties}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label={t.player.position}
      />
      <span className="time">{fmtTime(duration)}</span>
    </div>
  );
}

export function Transport({ big }: { big?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const isWave = usePlayer((s) => s.source?.kind === 'wave');
  const sz = big ? 22 : 18;
  const t = useT();
  return (
    <div className={cx('transport', big && 'big')}>
      <button className={cx('icon-btn', shuffle && 'on')} onClick={toggleShuffle} disabled={isWave} title={t.player.shuffle}>
        <Shuffle size={sz - 2} />
      </button>
      <button className="icon-btn" onClick={prev} title={t.player.prev}>
        <SkipBack size={sz} fill="currentColor" />
      </button>
      <button className="play-btn" onClick={toggle} title={playing ? t.player.pause : t.player.play} data-testid="play-toggle">
        {loading && playing ? <Loader2 size={sz + 2} className="spin" /> : playing ? <Pause size={sz + 2} fill="currentColor" /> : <Play size={sz + 2} fill="currentColor" />}
      </button>
      <button className="icon-btn" onClick={() => next(true)} title={t.player.next} data-testid="next">
        <SkipForward size={sz} fill="currentColor" />
      </button>
      <button className={cx('icon-btn', repeat !== 'off' && 'on')} onClick={cycleRepeat} disabled={isWave} title={t.player.repeat}>
        {repeat === 'one' ? <Repeat1 size={sz - 2} /> : <Repeat size={sz - 2} />}
      </button>
    </div>
  );
}

export function LikeButton({ track, size = 18 }: { track: Track; size?: number }) {
  const liked = useApp((s) => s.liked.has(String(track.id)));
  const t = useT();
  return (
    <button className={cx('icon-btn', liked && 'on like')} onClick={() => toggleLike(track)} title={t.common.like}>
      <Heart size={size} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const before = useRef(0.8);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const t = useT();
  return (
    <div className="volume">
      <button
        className="icon-btn"
        onClick={() => {
          if (volume > 0) {
            before.current = volume;
            setVolume(0);
          } else setVolume(before.current || 0.8);
        }}
        title={t.player.volume}
      >
        <Icon size={18} />
      </button>
      <input
        type="range"
        className="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        style={{ '--p': `${volume * 100}%` } as React.CSSProperties}
        onChange={(e) => setVolume(Number(e.target.value))}
        onWheel={(e) => setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05))}
        aria-label={t.player.volume}
      />
    </div>
  );
}

export function PlayerBar() {
  const track = usePlayer((s) => s.queue[s.index]);
  const isWave = usePlayer((s) => s.source?.kind === 'wave');
  const t = useT();
  const sourceTitle = usePlayer((s) => (s.source?.kind === 'list' ? s.source.title : t.common.myWave));
  const openNow = () => useApp.setState({ nowPlayingOpen: true });

  return (
    <footer className="playerbar glass">
      <div className="pb-left">
        {track ? (
          <>
            <button className="pb-cover" onClick={openNow} title={t.player.expand}>
              <Cover src={trackCover(track, 200)} size={56} />
            </button>
            <div className="pb-meta">
              <div className="pb-title" title={track.title} data-testid="now-title">
                {track.title}
                {track.version && <span className="tr-version"> {track.version}</span>}
              </div>
              <div className="pb-artists">
                <ArtistLinks artists={track.artists} />
              </div>
            </div>
            <LikeButton track={track} />
            {isWave && (
              <button className="icon-btn" onClick={() => dislike(track)} title={t.common.dontRecommend}>
                <Ban size={17} />
              </button>
            )}
          </>
        ) : (
          <div className="pb-empty">{t.player.nothing}</div>
        )}
      </div>
      <div className="pb-center">
        <Transport />
        <SeekBar />
      </div>
      <div className="pb-right">
        {track && (
          <span className="pb-source" title={t.player.source}>
            {isWave && <Waves size={14} />} {sourceTitle}
          </span>
        )}
        <button className="icon-btn" onClick={openNow} title={t.player.queue}>
          <ListMusic size={18} />
        </button>
        <VolumeControl />
        <button className="icon-btn" onClick={openNow} title={t.player.fullscreen}>
          <Maximize2 size={16} />
        </button>
      </div>
    </footer>
  );
}
