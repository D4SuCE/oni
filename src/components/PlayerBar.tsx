import { Ban, Heart, ListMusic, Loader2, Maximize2, MoreHorizontal, Pause, PictureInPicture2, Play, Repeat, Repeat1, Shuffle, SlidersVertical, SkipBack, SkipForward, Volume1, Volume2, VolumeX, Waves } from 'lucide-react';
import { useRef } from 'react';
import type { Track } from '../api/types.ts';
import { trackCover } from '../api/yandex.ts';
import { useLang, useT } from '../i18n.ts';
import { cycleRepeat, next, prev, seek, setVolume, sourceTitle, toggle, toggleShuffle, usePlayer } from '../player/player.ts';
import { dislike, toggleLike, useApp } from '../store.ts';
import { cx, fmtTime } from '../ui/util.ts';
import { useEq } from '../player/eq.ts';
import { isIos } from '../ui/platform.ts';
import { ArtistLinks, Cover } from './Common.tsx';
import { openMenu } from './Menu.tsx';
import { isUpload, trackMenu } from './TrackList.tsx';

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

export function VolumeControl({ className }: { className?: string }) {
  const volume = usePlayer((s) => s.volume);
  const before = useRef(0.8);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const t = useT();
  return (
    <div className={cx('volume', className)}>
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
  useLang((s) => s.lang); // the source title is localized
  const source = usePlayer((s) => s.source);
  const openNow = () => useApp.setState({ nowPlayingOpen: true });
  const eqOn = useEq((s) => s.enabled);

  return (
    // On the iPhone the whole bar opens Now Playing (its buttons keep their own job).
    <footer className="playerbar glass" onClick={isIos ? (e) => track && !(e.target as Element).closest('button, a, input') && openNow() : undefined}>
      {/* The playing track has the same menu as in any list: share it, add it to a playlist… even from the wave. */}
      <div className="pb-left" onContextMenu={(e) => track && openMenu(e, trackMenu(track))}>
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
                <ArtistLinks artists={track.artists} plain={isIos || isUpload(track)} />
              </div>
            </div>
            <LikeButton track={track} />
            {isWave && (
              <button className="icon-btn" onClick={() => dislike(track)} title={t.common.dontRecommend}>
                <Ban size={17} />
              </button>
            )}
            <button className="icon-btn pb-more" onClick={(e) => openMenu(e, trackMenu(track))} title={t.common.more} data-testid="now-more">
              <MoreHorizontal size={18} />
            </button>
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
            {isWave && <Waves size={14} />} {sourceTitle(source)}
          </span>
        )}
        <button className="icon-btn" onClick={openNow} title={t.player.queue}>
          <ListMusic size={18} />
        </button>
        <button className={cx('icon-btn', eqOn && 'on')} onClick={() => useApp.setState((s) => ({ soundOpen: !s.soundOpen }))} title={t.sound.title} data-testid="sound-button">
          <SlidersVertical size={18} />
        </button>
        <VolumeControl />
        {window.wave?.openMini && (
          <button className="icon-btn" onClick={() => window.wave?.openMini?.()} title={t.mini.open} data-testid="mini-button">
            <PictureInPicture2 size={17} />
          </button>
        )}
        <button className="icon-btn" onClick={openNow} title={t.player.fullscreen}>
          <Maximize2 size={16} />
        </button>
      </div>
    </footer>
  );
}
