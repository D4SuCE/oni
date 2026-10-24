import { useCover } from '../ui/offline.ts';
import { Ban, Heart, ListMusic, Loader2, Maximize2, Moon, MoreHorizontal, Pause, PictureInPicture2, Play, Repeat, Repeat1, Shuffle, SlidersVertical, SkipBack, SkipForward, Volume1, Volume2, VolumeX, Waves } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Track } from '../api/types.ts';
import { useT } from '../i18n.ts';
import { cycleRepeat, next, prev, seek, setSleep, setVolume, toggle, toggleShuffle, usePlayer } from '../player/player.ts';
import { useSourceTitle } from './SourceTitle.ts';
import { dislike, toggleLike, useApp } from '../store.ts';
import { cx, fmtTime } from '../ui/util.ts';
import { useEq } from '../player/eq.ts';
import { isIos } from '../ui/platform.ts';
import { ArtistLinks, Cover } from './Common.tsx';
import { openMenu } from './Menu.tsx';
import { isUpload, trackMenu } from './TrackList.tsx';

/** The sleep timer: a moon, with the minutes left beside it while it runs; its menu sets it. */
export function SleepButton({ size = 18 }: { size?: number }) {
  const t = useT().player;
  const sleep = usePlayer((s) => s.sleep);
  const [, tick] = useState(0);
  // The minutes left move on while it runs.
  useEffect(() => {
    if (!sleep.until) return;
    const timer = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, [sleep.until]);
  const on = Boolean(sleep.until) || sleep.afterTrack;
  const left = sleep.until ? Math.max(1, Math.ceil((sleep.until - Date.now()) / 60_000)) : 0;
  const label = sleep.until ? t.sleepLeft(left) : sleep.afterTrack ? t.sleepEnd : '';
  return (
    <button
      className={cx('icon-btn sleep-btn', on && 'on')}
      title={on ? `${t.sleep}: ${label}` : t.sleep}
      data-testid="sleep"
      onClick={(e) =>
        openMenu(e, [
          ...[15, 30, 45, 60].map((n) => ({ label: t.sleepMinutes(n), onClick: () => setSleep(n) })),
          { label: t.sleepTrack, onClick: () => setSleep('track') },
          ...(on ? [{ label: '', separator: true }, { label: t.sleepOff, danger: true, onClick: () => setSleep(null) }] : []),
        ])
      }
    >
      <Moon size={size} />
      {sleep.until ? <span className="sleep-left">{left}</span> : null}
    </button>
  );
}

export function SeekBar({ className }: { className?: string }) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  // While a finger or the mouse holds it, the slider shows where it is taken and seeks once, on
  // release: a seek per move queued up (the track went on from the old place for seconds), and
  // the bar followed the playing position, behind the thumb.
  const [drag, setDrag] = useState<number | null>(null);
  const holding = useRef(false);
  const shown = drag ?? position;
  const p = duration ? (shown / duration) * 100 : 0;
  const release = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!holding.current) return;
    holding.current = false;
    seek(Number(e.currentTarget.value));
    setDrag(null);
  };
  const t = useT();
  return (
    <div className={cx('seek', className)}>
      {/* While the bar is held, the time it goes to, lit (the user: there was no telling what time a
          seek went to; there, not over the hand, by the user's choice). */}
      <span className={cx('time', drag !== null && 'seeking')} data-testid="seek-time">
        {fmtTime(shown)}
      </span>
      <span className="seek-track">
        <input
          type="range"
          className="range"
          min={0}
          max={duration || 1}
          step={0.5}
          value={shown}
          style={{ '--p': `${p}%` } as React.CSSProperties}
          onPointerDown={() => (holding.current = true)}
          onPointerUp={release}
          onPointerCancel={release}
          // Held: follow the hand; otherwise (the keyboard) seek right away.
          onChange={(e) => (holding.current ? setDrag(Number(e.target.value)) : seek(Number(e.target.value)))}
          aria-label={t.player.position}
        />
      </span>
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
    <button className={cx('icon-btn', liked && 'on like')} onClick={() => toggleLike(track)} title={t.common.like} data-testid="like">
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
  const cover = useCover(track, 200);
  const isWave = usePlayer((s) => s.source?.kind === 'wave');
  const t = useT();
  const source = usePlayer((s) => s.source);
  const sourceTitle = useSourceTitle(source);
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
              <Cover src={cover} size={56} />
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
            {isWave && <Waves size={14} />}
            <span className="pb-source-text">{sourceTitle}</span>
          </span>
        )}
        <SleepButton />
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
