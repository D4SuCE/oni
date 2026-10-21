import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, ChevronDown, MoreHorizontal, SlidersVertical, X } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { trackCover } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { playAt, playTracks, removeAt, seek, usePlayer } from '../player/player.ts';
import { dislike, useApp } from '../store.ts';
import { useSwipeDown } from '../ui/swipe.ts';
import { cx, useAsync } from '../ui/util.ts';
import { ArtistLinks, Cover, Spinner } from './Common.tsx';
import { LikeButton, SeekBar, Transport, VolumeControl } from './PlayerBar.tsx';
import { processingOn, useProcessing } from '../player/processing.ts';
import { isIos } from '../ui/platform.ts';
import { BackgroundVideo, LiveCover, useCoverVideo } from './LiveCover.tsx';
import { openMenu } from './Menu.tsx';
import { isUpload, TrackList, trackMenu } from './TrackList.tsx';
import { WaveStatsLine } from './Wave.tsx';

function parseLrc(text: string) {
  const lines: { t: number; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(raw.trim());
    if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return lines;
}

function Lyrics({ trackId }: { trackId: string }) {
  const { data, loading, error } = useAsync(() => api.lyrics(trackId), [trackId]);
  const position = usePlayer((s) => s.position);
  const lines = useMemo(() => (data?.synced ? parseLrc(data.text) : []), [data]);
  const active = lines.findLastIndex((l) => l.t <= position + 0.3);
  const box = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    box.current?.querySelector('.lyric.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);
  if (loading) return <Spinner />;
  if (error || !data) return <div className="muted pad">{t.nowPlaying.noLyrics}</div>;
  if (!data.synced) return <div className="lyrics-plain">{data.text}</div>;
  return (
    <div className="lyrics" ref={box}>
      {lines.map((l, i) => (
        <p key={i} className={cx('lyric', i === active && 'active', i < active && 'past')} onClick={() => seek(l.t)}>
          {l.text || '♪'}
        </p>
      ))}
    </div>
  );
}

function Similar({ track }: { track: Track }) {
  const { data, loading, error } = useAsync(() => api.similarTracks(track.id), [track.id]);
  const t = useT();
  if (loading) return <Spinner />;
  if (error || !data?.length) return <div className="muted pad">{t.nowPlaying.noSimilar}</div>;
  return (
    <div className="similar">
      <TrackList tracks={data} showAlbum={false} onPlay={(i) => playTracks(data, i, t.nowPlaying.similarTo(track.title))} />
    </div>
  );
}

function Queue() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isWave = usePlayer((s) => s.source?.kind === 'wave');
  const waveBusy = usePlayer((s) => s.waveBusy);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    ref.current?.querySelector('.q-row.current')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const upcoming = queue.slice(index + 1, index + 101);
  return (
    <div className="queue" ref={ref}>
      {queue[index] && (
        <>
          <div className="q-label">{t.nowPlaying.now}</div>
          <QueueRow i={index} current />
        </>
      )}
      <div className="q-label">{t.nowPlaying.upNext} {isWave && <WaveStatsLine />}</div>
      {upcoming.map((_, k) => (
        <QueueRow key={`${queue[index + 1 + k].id}-${index + 1 + k}`} i={index + 1 + k} />
      ))}
      {!upcoming.length && <div className="muted pad">{isWave || waveBusy ? t.nowPlaying.wavePicking : t.nowPlaying.queueEmpty}</div>}
    </div>
  );
}

function QueueRow({ i, current }: { i: number; current?: boolean }) {
  const t = usePlayer((s) => s.queue[i]);
  const suggested = usePlayer((s) => s.source?.kind === 'list' && !!t && !!s.source.suggested?.includes(String(t.id)));
  const tx = useT();
  if (!t) return null;
  return (
    <div
      className={cx('q-row', current && 'current')}
      onDoubleClick={() => playAt(i)}
      onContextMenu={(e) => openMenu(e, trackMenu(t, current ? [] : [{ label: tx.nowPlaying.removeFromQueue, icon: <X size={15} />, onClick: () => removeAt(i) }]))}
    >
      <Cover src={trackCover(t, 100)} size={40} />
      <div className="tr-main" onClick={() => playAt(i)}>
        <div className="tr-title">
          {suggested && (
            <span className="suggested" title={tx.nowPlaying.suggested} data-testid="suggested">
              ✦
            </span>
          )}
          {t.title}
        </div>
        <div className="tr-artists">{t.artists?.map((a) => a.name).join(', ')}</div>
      </div>
      {!current && (
        <button className="icon-btn" title={tx.nowPlaying.removeFromQueue} onClick={() => removeAt(i)}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function NowPlaying() {
  const track = usePlayer((s) => s.queue[s.index]);
  const isWave = usePlayer((s) => s.source?.kind === 'wave');
  const [picked, setTab] = useState<'queue' | 'lyrics' | 'similar'>('queue');
  const video = useCoverVideo(track);
  const t = useT();
  const close = useCallback(() => useApp.setState({ nowPlayingOpen: false }), []);
  const sheet = useRef<HTMLDivElement>(null);
  useSwipeDown(sheet, close);
  const volumeSlider = useProcessing((s) => s.volumeSlider);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  const hasLyrics = Boolean(track?.lyricsInfo?.hasAvailableSyncLyrics || track?.lyricsInfo?.hasAvailableTextLyrics);
  // A track without lyrics shows the queue; the lyrics tab comes back with the next track that has them.
  const tab = picked === 'lyrics' && !hasLyrics ? 'queue' : picked;

  return (
    <div ref={sheet} className={cx('nowplaying', video && 'has-video')}>
      {video && <BackgroundVideo key={track?.id} src={video} poster={trackCover(track, 1000)} />}
      <div className="np-drag" />
      <button className="icon-btn np-close" onClick={close} title={t.nowPlaying.collapse}>
        <ChevronDown size={24} />
      </button>
      <div className="np-stage">
        <div className="np-art">
          <LiveCover track={track} className="np-cover" />
          {track && (
            <>
              <div className="np-meta" onContextMenu={(e) => openMenu(e, trackMenu(track))}>
                <div className="np-text">
                  <h1 title={track.title}>{track.title}</h1>
                  <div className="np-artists">
                    <ArtistLinks artists={track.artists} plain={isUpload(track)} />
                  </div>
                </div>
                <div className="np-actions">
                  {isWave && (
                    <button className="icon-btn" onClick={() => dislike(track)} title={t.common.dontRecommend}>
                      <Ban size={20} />
                    </button>
                  )}
                  <LikeButton track={track} size={22} />
                  {/* The equalizer on the iPhone, where the player bar has no room for it. */}
                  {isIos && processingOn && (
                    <button className="icon-btn" onClick={() => useApp.setState({ soundOpen: true })} title={t.sound.title} data-testid="np-sound">
                      <SlidersVertical size={21} />
                    </button>
                  )}
                  <button className="icon-btn" onClick={(e) => openMenu(e, trackMenu(track))} title={t.common.more} data-testid="np-more">
                    <MoreHorizontal size={22} />
                  </button>
                </div>
              </div>
              <SeekBar className="np-seek" />
              <Transport big />
              {isIos && processingOn && volumeSlider && <VolumeControl className="np-volume" />}
            </>
          )}
        </div>
        <aside className="np-side glass">
          <div className="tabs">
            <button className={cx('tab', tab === 'queue' && 'active')} onClick={() => setTab('queue')}>
              {t.player.queue}
            </button>
            <button className={cx('tab', tab === 'lyrics' && 'active')} onClick={() => setTab('lyrics')} disabled={!hasLyrics} title={hasLyrics ? '' : t.nowPlaying.lyricsMissing}>
              {t.nowPlaying.lyrics}
            </button>
            <button className={cx('tab', tab === 'similar' && 'active')} onClick={() => setTab('similar')} data-testid="tab-similar">
              {t.nowPlaying.similar}
            </button>
          </div>
          {tab === 'queue' || !track ? <Queue /> : tab === 'lyrics' ? <Lyrics trackId={track.id} /> : <Similar track={track} />}
        </aside>
      </div>
    </div>
  );
}
