// The mini player window (#mini): a remote for the main window, which keeps playing the music.
// State arrives from the shell (wave:playback / wave:progress); buttons send commands back.

import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MiniCommand, ShellPlayback, ShellProgress } from '../api/transport.ts';
import { useLang, useT } from '../i18n.ts';
import { cx } from '../ui/util.ts';

const send = (cmd: MiniCommand) => window.wave?.miniCommand?.(cmd);

function useShellState() {
  const [state, setState] = useState<ShellPlayback | null>(null);
  const [progress, setProgress] = useState<(ShellProgress & { at: number }) | null>(null);
  useEffect(() => {
    window.wave?.onPlayback?.((s) => setState(s));
    window.wave?.onProgress?.((p) => setProgress({ ...p, at: performance.now() }));
    window.wave?.miniReady?.();
  }, []);
  return { state, progress };
}

/** Moves the bar smoothly between the once-a-second updates. */
function Progress({ progress }: { progress: (ShellProgress & { at: number }) | null }) {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (bar.current && progress?.duration) {
        const pos = progress.position + (progress.playing ? (performance.now() - progress.at) / 1000 : 0);
        bar.current.style.width = `${Math.min(100, (pos / progress.duration) * 100)}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [progress]);
  return (
    <div className="mini-progress">
      <i ref={bar} />
    </div>
  );
}

function MiniPlayer() {
  const t = useT();
  const { state, progress } = useShellState();
  useLang((s) => s.lang);
  const has = Boolean(state?.hasTrack);
  return (
    <div className="mini drag" data-testid="mini">
      <div className="mini-cover">{state?.cover ? <img src={state.cover} alt="" draggable={false} /> : <span className="logo-mark" />}</div>
      <div className="mini-main">
        <div className="mini-title" title={state?.title} data-testid="mini-title">
          {has ? state!.title : t.player.nothing}
        </div>
        <div className="mini-artist">{has ? state!.artist : ''}</div>
        <div className="mini-controls no-drag">
          <button className="icon-btn" onClick={() => send('prev')} disabled={!has} title={t.player.prev}>
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button className="play-btn" onClick={() => send('toggle')} disabled={!has} title={state?.playing ? t.player.pause : t.player.play} data-testid="mini-toggle">
            {state?.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => send('next')} disabled={!has} title={t.player.next}>
            <SkipForward size={17} fill="currentColor" />
          </button>
          <button className={cx('icon-btn', state?.liked && 'on like')} onClick={() => send('like')} disabled={!has} title={t.common.like}>
            <Heart size={16} fill={state?.liked ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
      <div className="mini-corner no-drag">
        <button className="icon-btn small" onClick={() => send('expand')} title={t.mini.expand} data-testid="mini-expand">
          <Maximize2 size={14} />
        </button>
        <button className="icon-btn small" onClick={() => send('close')} title={t.mini.close}>
          <X size={15} />
        </button>
      </div>
      <Progress progress={progress} />
    </div>
  );
}

export function mountMini() {
  document.documentElement.classList.add('mini-window');
  createRoot(document.getElementById('root')!).render(<MiniPlayer />);
}
