import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Ban, ChevronDown, GripVertical, ListMusic, MicVocal, MoreHorizontal, SlidersVertical, X } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { catalogTrack, trackCover } from '../api/yandex.ts';
import { useT } from '../i18n.ts';
import { moveInQueue, playAt, playTracks, removeAt, seek, usePlayer } from '../player/player.ts';
import { useDragSort } from '../ui/dragSort.ts';
import { dislike, useApp } from '../store.ts';
import { useSwipeDown } from '../ui/swipe.ts';
import { cx, useAsync } from '../ui/util.ts';
import { ArtistLinks, Cover, Spinner } from './Common.tsx';
import { DevicesButton, PlayingOn } from './Devices.tsx';
import { LikeButton, SeekBar, SleepButton, Transport, VolumeControl } from './PlayerBar.tsx';
import { usePhoneSound } from '../player/phoneSound.ts';
import { useEq } from '../player/eq.ts';
import { geniusSearch, lyricsKnown, lyricsOf, useLyrics, wrongLyrics } from '../player/lyrics.ts';
import { useElsewhere } from '../sync/elsewhere.ts';
import { isIos } from '../ui/platform.ts';
import { BackgroundVideo, LiveCover, useCoverVideo } from './LiveCover.tsx';
import { openMenu } from './Menu.tsx';
import { plainArtists, TrackList, trackMenu } from './TrackList.tsx';
import { WaveStatsLine } from './Wave.tsx';

function parseLrc(text: string) {
  const lines: { t: number; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(raw.trim());
    if (m) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return lines;
}

function Lyrics({ track }: { track: Track }) {
  // Asked again when what is known changes ("Wrong lyrics"): it comes from what is kept then.
  const known = useLyrics((s) => s.v);
  const { data, loading, error } = useAsync(() => lyricsOf(track), [track.id, known]);
  const position = usePlayer((s) => s.position);
  const lines = useMemo(() => (data?.synced ? parseLrc(data.text) : []), [data]);
  const active = lines.findLastIndex((l) => l.t <= position + 0.3);
  const box = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    box.current?.querySelector('.lyric.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);
  if (loading) return <Spinner />;
  const genius = (
    <button className="btn small" onClick={() => geniusSearch(track)} data-testid="lyrics-genius">
      {t.nowPlaying.findOnGenius}
    </button>
  );
  if (error || !data)
    return (
      <div className="muted pad lyrics-none">
        {t.nowPlaying.noLyrics}
        {genius}
      </div>
    );
  // Not Yandex's: where it is from, and a way out if it is another song's.
  const source = data.source === 'lrclib' && (
    <div className="lyrics-source" data-testid="lyrics-source">
      <span>{t.nowPlaying.lyricsFrom('LRCLIB')}</span>
      <button className="btn small" onClick={() => wrongLyrics(track)} data-testid="lyrics-wrong">
        {t.nowPlaying.wrongLyrics}
      </button>
      {genius}
    </div>
  );
  if (!data.synced)
    return (
      <div className="lyrics-plain">
        {data.text}
        {source}
      </div>
    );
  return (
    <div className="lyrics" ref={box}>
      {lines.map((l, i) => (
        <p key={i} className={cx('lyric', i === active && 'active', i < active && 'past')} onClick={() => seek(l.t)}>
          {l.text || '♪'}
        </p>
      ))}
      {source}
    </div>
  );
}

function Similar({ track }: { track: Track }) {
  // An upload Yandex has found: the catalog track's similar ones.
  const { data, loading, error } = useAsync(() => api.similarTracks(catalogTrack(track)?.id ?? track.id), [track.id]);
  const t = useT();
  if (loading) return <Spinner />;
  if (error || !data?.length) return <div className="muted pad">{t.nowPlaying.noSimilar}</div>;
  return (
    <div className="similar">
      <TrackList tracks={data} showAlbum={false} onPlay={(i) => playTracks(data, i, t.nowPlaying.similarTo(track.title), undefined, { label: { key: 'similar', arg: track.title } })} />
    </div>
  );
}

/** What plays now and next. Up-next tracks are dragged to another place: by the held mouse button,
 * or on the iPhone (its queue sheet) by their handles. */
function Queue() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const isWave = usePlayer((s) => s.source?.kind === 'wave');
  const waveBusy = usePlayer((s) => s.waveBusy);
  const ref = useRef<HTMLDivElement>(null);
  const t = useT();
  useDragSort(ref, { enabled: true, mode: isIos ? 'handle' : 'row', onMove: moveInQueue });
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
  const handle = isIos && !current;
  const t = usePlayer((s) => s.queue[i]);
  const suggested = usePlayer((s) => s.source?.kind === 'list' && !!t && !!s.source.suggested?.includes(String(t.id)));
  const tx = useT();
  if (!t) return null;
  return (
    <div
      className={cx('q-row', current && 'current')}
      data-sort-index={current ? undefined : i}
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
      {handle && (
        <span className="drag-handle" title={tx.menu.move} data-testid="drag-handle">
          <GripVertical size={18} />
        </span>
      )}
    </div>
  );
}

/** In the iPhone's lyrics, a swipe down (not on the lyrics, which scroll) goes back to the cover.
 * Touch events: iOS cancels a pointer as soon as anything under it scrolls. */
function useLyricsSwipe(ref: RefObject<HTMLDivElement | null>, on: boolean, back: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on) return;
    let from: { x: number; y: number } | null = null;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      from = e.touches.length === 1 && !(e.target as Element).closest('.np-sung, input, .q-sheet') ? { x: t.clientX, y: t.clientY } : null;
    };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (from && t && t.clientY - from.y > 60 && Math.abs(t.clientX - from.x) < t.clientY - from.y) back();
      from = null;
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchend', up);
    return () => {
      el.removeEventListener('touchstart', down);
      el.removeEventListener('touchend', up);
    };
  }, [ref, on, back]);
}

/** The iPhone: the cover takes the height the name, buttons and controls leave it, and stays square
 * (a whole name on two or three lines would push the controls off the screen). Sets --np-cover on
 * the column, read by styles.css under html.ios; the desktop's layout is left as it is. */
function useCoverFit(art: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const box = art.current;
    if (!isIos || !box) return;
    const fit = () => {
      let rest = 0;
      for (const el of box.children) {
        if (el.classList.contains('np-cover')) continue;
        const s = getComputedStyle(el);
        rest += (el as HTMLElement).offsetHeight + parseFloat(s.marginTop) + parseFloat(s.marginBottom);
      }
      box.style.setProperty('--np-cover', `${Math.max(160, Math.floor(box.clientHeight - rest))}px`);
    };
    const watch = new ResizeObserver(fit);
    const observe = () => {
      watch.disconnect();
      watch.observe(box);
      for (const el of box.children) if (!el.classList.contains('np-cover')) watch.observe(el);
    };
    // Children come and go (a track, the volume slider): watched anew.
    const children = new MutationObserver(() => {
      observe();
      fit();
    });
    observe();
    children.observe(box, { childList: true });
    fit();
    return () => {
      watch.disconnect();
      children.disconnect();
    };
  }, [art]);
}

export function NowPlaying() {
  const track = usePlayer((s) => s.queue[s.index]);
  const isWave = usePlayer((s) => s.source?.kind === 'wave');
  // The equalizer's button is red while it is on, as in the desktop's player bar (the user).
  const eqOn = useEq((s) => s.enabled);
  const [picked, setTab] = useState<'queue' | 'lyrics' | 'similar'>('queue');
  // The iPhone has no room for the queue beside the cover: it opens as a sheet.
  const [sheetOpen, setSheet] = useState<'queue' | null>(null);
  // The iPhone's lyrics: the cover shrinks into a row with the name and the lyrics take its place,
  // the controls staying below (the user, 26.10.2026: variant B — not a page over Now Playing). A
  // swipe down goes back to the cover; another closes Now Playing.
  const [sung, setSung] = useState(false);
  const video = useCoverVideo(track);
  const t = useT();
  const close = useCallback(() => useApp.setState({ nowPlayingOpen: false }), []);
  const sheet = useRef<HTMLDivElement>(null);
  useSwipeDown(sheet, close, undefined, !sung);
  useLyricsSwipe(sheet, sung, () => setSung(false));
  const volumeSlider = usePhoneSound((s) => s.volumeSlider);
  const remote = useElsewhere((s) => Boolean(s.controlling));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  // Yandex's, or LRCLIB's where Yandex has none: off only once both said "none" (asked once per track).
  useLyrics((s) => s.v);
  const hasLyrics = lyricsKnown(track) !== 'no';
  useEffect(() => {
    if (track && lyricsKnown(track) === 'unknown') lyricsOf(track).catch(() => {});
  }, [track]);
  // A track without lyrics shows the queue; the lyrics tab comes back with the next track that has them.
  // None found: the tab and the button are dim but open "none" with Genius's search (it was off, and
  // Genius could not be reached at all).
  const tab = picked;
  const art = useRef<HTMLDivElement>(null);
  useCoverFit(art);

  return (
    <div ref={sheet} className={cx('nowplaying', video && 'has-video', sung && 'sung')}>
      {video && <BackgroundVideo key={track?.id} src={video} poster={trackCover(track, 1000)} />}
      <div className="np-drag" />
      <button className="icon-btn np-close" onClick={close} title={t.nowPlaying.collapse}>
        <ChevronDown size={24} />
      </button>
      <div className="np-stage">
        <div ref={art} className="np-art">
          {/* in the lyrics the small cover takes back to the big one */}
          <LiveCover track={track} className="np-cover" onClick={sung ? () => setSung(false) : undefined} />
          {track && (
            <>
              <div className="np-meta" onContextMenu={(e) => openMenu(e, trackMenu(track))}>
                <div className="np-text">
                  {/* A long name gets a smaller face on the iPhone, so it is there whole (styles.css). */}
                  <h1 title={track.title} className={cx(track.title.length > 36 && 'long')}>
                    {track.title}
                  </h1>
                  <div className="np-artists">
                    <ArtistLinks artists={track.artists} plain={plainArtists(track)} />
                  </div>
                  <PlayingOn />
                </div>
                <div className="np-actions">
                  {isWave && (
                    <button className="icon-btn" onClick={() => dislike(track)} title={t.common.dontRecommend}>
                      <Ban size={20} />
                    </button>
                  )}
                  <LikeButton track={track} size={22} />
                  <SleepButton size={20} />
                  <DevicesButton size={20} />
                  {/* The equalizer on the iPhone, where the player bar has no room for it. */}
                  {isIos && (
                    <button className={cx('icon-btn', eqOn && 'on')} onClick={() => useApp.setState({ soundOpen: true })} title={t.sound.title} data-testid="np-sound">
                      <SlidersVertical size={21} />
                    </button>
                  )}
                  {/* The lyrics on the iPhone too (the user, 25.10.2026: "is there a page with the lyrics?"). */}
                  {isIos && (
                    <button className={cx('icon-btn', !hasLyrics && 'dim', sung && 'on')} onClick={() => setSung(!sung)} title={hasLyrics ? t.nowPlaying.lyrics : t.nowPlaying.lyricsMissing} data-testid="np-lyrics">
                      <MicVocal size={21} />
                    </button>
                  )}
                  {isIos && (
                    <button className="icon-btn" onClick={() => setSheet('queue')} title={t.player.queue} data-testid="np-queue">
                      <ListMusic size={21} />
                    </button>
                  )}
                  <button className="icon-btn" onClick={(e) => openMenu(e, trackMenu(track))} title={t.common.more} data-testid="np-more">
                    <MoreHorizontal size={22} />
                  </button>
                </div>
              </div>
              {isIos && sung && (
                <div className="np-sung" data-testid="np-sung">
                  <Lyrics track={track} />
                </div>
              )}
              <SeekBar className="np-seek" />
              <Transport big />
              {/* A remote always has it: the volume there (the iPhone's buttons are the phone's own). */}
              {isIos && (volumeSlider || remote) && <VolumeControl className="np-volume" />}
            </>
          )}
        </div>
        <aside className="np-side glass">
          <div className="tabs">
            <button className={cx('tab', tab === 'queue' && 'active')} onClick={() => setTab('queue')}>
              {t.player.queue}
            </button>
            <button className={cx('tab', tab === 'lyrics' && 'active', !hasLyrics && 'dim')} onClick={() => setTab('lyrics')} title={hasLyrics ? '' : t.nowPlaying.lyricsMissing} data-testid="tab-lyrics">
              {t.nowPlaying.lyrics}
            </button>
            <button className={cx('tab', tab === 'similar' && 'active')} onClick={() => setTab('similar')} data-testid="tab-similar">
              {t.nowPlaying.similar}
            </button>
          </div>
          {tab === 'queue' || !track ? <Queue /> : tab === 'lyrics' ? <Lyrics track={track} /> : <Similar track={track} />}
        </aside>
        {sheetOpen && (
          <div className="q-sheet-backdrop" onClick={() => setSheet(null)}>
            <div className="q-sheet glass" onClick={(e) => e.stopPropagation()} data-testid={`${sheetOpen}-sheet`}>
              <div className="q-sheet-head">
                <h3>{t.player.queue}</h3>
                <button className="icon-btn" onClick={() => setSheet(null)} title={t.common.close}>
                  <X size={20} />
                </button>
              </div>
              <div className="q-sheet-list">
                <Queue />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
