import { useEffect, useRef, useState } from 'react';
import type { Track } from '../api/types.ts';
import { trackCover } from '../api/yandex.ts';
import { usePlayer } from '../player/player.ts';
import { useMotion } from '../ui/motion.ts';
import { cx } from '../ui/util.ts';
import { Cover } from './Common.tsx';

/** The track's looping cover video, if it has one and live covers are on. */
export function useCoverVideo(track?: Track) {
  const motion = useMotion((s) => s.enabled);
  return motion ? track?.backgroundVideoUri : undefined;
}

/**
 * Yandex's cover video (vertical, 9:16) filling the Now Playing screen behind a dark
 * gradient, like the official app. Muted and in step with the music. Remount per
 * track (key) so a failed video of one track doesn't stick to the next.
 */
export function BackgroundVideo({ src, poster }: { src: string; poster?: string }) {
  const playing = usePlayer((s) => s.playing);
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing]);

  if (failed) return null;
  return (
    <div className="np-video" data-testid="live-video" aria-hidden>
      <video ref={video} src={src} poster={poster} muted loop playsInline autoPlay={playing} onError={() => setFailed(true)} />
    </div>
  );
}

/** The big cover: drifts slowly while the music plays (live covers on), still otherwise. */
export function LiveCover({ track, className }: { track?: Track; className?: string }) {
  const motion = useMotion((s) => s.enabled);
  const playing = usePlayer((s) => s.playing);
  return <Cover src={trackCover(track, 1000)} className={cx(className, motion && 'drift', motion && !playing && 'paused')} />;
}
