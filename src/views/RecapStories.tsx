// "Recap" as stories (the user's pick after 1.9.0): full-screen cards one after another, as music
// services show the year at its end: the minutes, the top artist and track, the top fives, the
// genres, and a summary to keep or share as a picture (drawn here, 1080×1920, in Oni's colors).
// A tap on the right goes on, on the left back; a held finger pauses; each card goes on by itself.

import { ChevronLeft, ChevronRight, Copy, Download, Share2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSwipeDown } from '../ui/swipe.ts';
import { transport } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { trackCover } from '../api/yandex.ts';
import { Cover } from '../components/Common.tsx';
import { useLang, useT } from '../i18n.ts';
import type { Recap } from '../player/playLog.ts';
import { toast } from '../store.ts';
import { isIos } from '../ui/platform.ts';
import { cx } from '../ui/util.ts';

/** How long a card stays before the next. */
const CARD_MS = 6500;

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export function RecapStories({ recap, period, genreTitles, onClose }: { recap: Recap; period: string; genreTitles: Record<string, string>; onClose: () => void }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const s$ = t.recap.stories;
  const artist = recap.artists[0];
  const track = recap.tracks[0];
  const genres = recap.genres.slice(0, 4);
  const genre = (id: string) => genreTitles[id] ?? id;
  const minutes = Math.round(recap.minutes);

  const cards: { id: string; body: ReactNode }[] = [
    {
      id: 'intro',
      body: (
        <div className="story-center">
          <div className="story-kanji">鬼</div>
          <div className="story-kicker">{s$.kicker}</div>
          <h1 className="story-title">{s$.intro(period)}</h1>
        </div>
      ),
    },
    {
      id: 'minutes',
      body: (
        <div className="story-center">
          <div className="story-kicker">{s$.minutesKicker}</div>
          <div className="story-big">{minutes.toLocaleString(lang)}</div>
          <div className="story-sub">{t.recap.minutes(minutes)}</div>
          <p className="story-note">{s$.minutesNote(recap.days, Math.round(minutes / 60))}</p>
        </div>
      ),
    },
    ...(artist
      ? [
          {
            id: 'artist',
            body: (
              <div className="story-center">
                <div className="story-kicker">{s$.topArtist}</div>
                <Cover src={trackCover(artist.track, 400)} size={220} round icon="user" className="story-cover" />
                <h1 className="story-title">{artist.artist.name}</h1>
                <p className="story-note">{s$.artistNote(t.recap.plays(artist.plays), percent(artist.plays, recap.plays))}</p>
              </div>
            ),
          },
          {
            id: 'artists',
            body: <TopList kicker={s$.topArtists} rows={recap.artists.slice(0, 5).map((a) => ({ key: String(a.artist.id), cover: trackCover(a.track, 100), round: true, title: a.artist.name, note: t.recap.plays(a.plays) }))} />,
          },
        ]
      : []),
    ...(track
      ? [
          {
            id: 'track',
            body: (
              <div className="story-center">
                <div className="story-kicker">{s$.topTrack}</div>
                <Cover src={trackCover(track.track, 400)} size={240} className="story-cover square" />
                <h1 className="story-title">{track.track.title}</h1>
                <div className="story-sub">{track.track.artists?.map((a) => a.name).join(', ')}</div>
                <p className="story-note">{s$.trackNote(t.recap.times(track.plays))}</p>
              </div>
            ),
          },
          {
            id: 'tracks',
            body: <TopList kicker={s$.topTracks} rows={recap.tracks.slice(0, 5).map((x) => ({ key: String(x.track.id), cover: trackCover(x.track, 100), title: x.track.title, note: `${x.track.artists?.map((a) => a.name).join(', ')} · ${t.recap.times(x.plays)}` }))} />,
          },
        ]
      : []),
    ...(genres.length
      ? [
          {
            id: 'genres',
            body: (
              <div className="story-center">
                <div className="story-kicker">{s$.genres}</div>
                <h1 className="story-title">{genre(genres[0].genre)}</h1>
                <div className="story-bars">
                  {genres.map((g) => (
                    <div key={g.genre} className="story-bar">
                      <span>{genre(g.genre)}</span>
                      <i style={{ width: `${percent(g.plays, recap.plays)}%` }} />
                      <b>{percent(g.plays, recap.plays)}%</b>
                    </div>
                  ))}
                </div>
              </div>
            ),
          },
        ]
      : []),
    {
      id: 'summary',
      body: <Summary recap={recap} period={period} genre={genres[0] ? genre(genres[0].genre) : ''} />,
    },
  ];

  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  // Pulled down by a finger, the stories close, as Now Playing does (the user: the close button
  // was a reach on the phone); a pull is no tap on the card, which would turn it.
  const frame = useRef<HTMLDivElement>(null);
  const pressedAt = useRef<number | null>(null);
  useSwipeDown(frame, onClose);
  const last = index === cards.length - 1;
  const go = (step: number) => setIndex((i) => Math.max(0, Math.min(cards.length - 1, i + step)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === ' ') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="stories" data-testid="recap-stories">
      <div className="story-frame" ref={frame}>
        <div className="story-bars-top">
          {cards.map((c, i) => (
            <span key={c.id} className={cx('story-progress', i < index && 'done')}>
              {/* The running one fills by a CSS animation; its end moves on (the summary stays). */}
              {i === index && <i className={cx(held && 'held')} style={{ animationDuration: `${CARD_MS}ms` }} onAnimationEnd={() => !last && go(1)} />}
            </span>
          ))}
        </div>
        <button className="icon-btn story-close" onClick={onClose} title={t.common.close} data-testid="stories-close">
          <X size={20} />
        </button>
        <div
          className={cx('story-card', `story-${cards[index].id}`)}
          data-testid="story-card"
          data-card={cards[index].id}
          onPointerDown={(e) => {
            pressedAt.current = e.clientY;
            setHeld(true);
          }}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onClick={(e) => {
            const pulled = pressedAt.current !== null && Math.abs(e.clientY - pressedAt.current) > 12;
            pressedAt.current = null;
            if ((e.target as Element).closest('button') || pulled) return;
            const r = e.currentTarget.getBoundingClientRect();
            go(e.clientX - r.left < r.width / 3 ? -1 : 1);
          }}
        >
          {cards[index].body}
        </div>
        {!isIos && (
          <>
            <button className="icon-btn story-nav prev" onClick={() => go(-1)} disabled={!index} title={s$.back}>
              <ChevronLeft size={22} />
            </button>
            <button className="icon-btn story-nav next" onClick={() => go(1)} disabled={last} title={s$.next} data-testid="story-next">
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TopList({ kicker, rows }: { kicker: string; rows: { key: string; cover?: string; round?: boolean; title: string; note: string }[] }) {
  return (
    <div className="story-list-wrap">
      <div className="story-kicker">{kicker}</div>
      <ol className="story-list">
        {rows.map((r, i) => (
          <li key={r.key}>
            <span className="story-rank">{i + 1}</span>
            <Cover src={r.cover} size={56} round={r.round} icon={r.round ? 'user' : 'music'} />
            <div>
              <div className="story-row-title">{r.title}</div>
              <div className="story-row-note">{r.note}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The last card: the period in four lines, and the picture of it to keep or share. */
function Summary({ recap, period, genre }: { recap: Recap; period: string; genre: string }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const s$ = t.recap.stories;
  const [busy, setBusy] = useState(false);
  const picture = useRef<Promise<Blob> | null>(null);
  const image = () => (picture.current ??= drawSummary(recap, period, genre, t.recap.stories.image, lang));
  const artist = recap.artists[0];
  const track = recap.tracks[0];

  const share = async () => {
    setBusy(true);
    try {
      const blob = await image();
      const file = new File([blob], 'oni-recap.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: s$.intro(period) }).catch(() => {});
      else toast(s$.cannotShare);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      const url = URL.createObjectURL(await image());
      const a = document.createElement('a');
      a.href = url;
      a.download = `Oni — ${s$.intro(period)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    setBusy(true);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await image() })]);
      toast(s$.copied);
    } catch {
      toast(s$.cannotShare);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="story-summary">
      <div className="story-kicker">{s$.intro(period)}</div>
      <div className="story-summary-grid">
        <div>
          <span>{s$.minutesKicker}</span>
          <b>{Math.round(recap.minutes).toLocaleString(lang)}</b>
        </div>
        {artist && (
          <div>
            <span>{s$.topArtist}</span>
            <b>{artist.artist.name}</b>
          </div>
        )}
        {track && (
          <div>
            <span>{s$.topTrack}</span>
            <b>{track.track.title}</b>
          </div>
        )}
        {genre && (
          <div>
            <span>{s$.genres}</span>
            <b>{genre}</b>
          </div>
        )}
      </div>
      <div className="story-actions">
        {isIos ? (
          <button className="btn primary" onClick={share} disabled={busy} data-testid="story-share">
            <Share2 size={16} /> {s$.share}
          </button>
        ) : (
          <>
            <button className="btn primary" onClick={save} disabled={busy} data-testid="story-save">
              <Download size={16} /> {s$.save}
            </button>
            <button className="btn glass-btn" onClick={copy} disabled={busy} data-testid="story-copy">
              <Copy size={16} /> {s$.copy}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the picture

/** A cover for the canvas, through the shell (the image CDN sends no CORS headers: an <img> would taint it). */
async function coverBitmap(track: Track | undefined, size: number) {
  const url = track ? trackCover(track, size) : undefined;
  if (!url || !transport.fetchBytes) return null;
  try {
    return await createImageBitmap(new Blob([await transport.fetchBytes(url)]));
  } catch {
    return null;
  }
}

/** Text cut with "…" to `width` px. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}

/** The summary as a 1080×1920 picture (a story's size), in Oni's colors and faces. */
async function drawSummary(recap: Recap, period: string, genre: string, labels: { title: (p: string) => string; minutes: string; artist: string; track: string; genre: string }, lang: string) {
  await document.fonts?.ready;
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  // The night, the blood moon and the kanji, as the app's backdrop.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#090909');
  bg.addColorStop(0.6, '#171514');
  bg.addColorStop(1, '#2a0d0f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const moon = ctx.createRadialGradient(820, 300, 20, 820, 300, 300);
  moon.addColorStop(0, 'rgba(217, 39, 46, 0.85)');
  moon.addColorStop(1, 'rgba(142, 23, 27, 0)');
  ctx.fillStyle = moon;
  ctx.beginPath();
  ctx.arc(820, 300, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(242, 238, 232, 0.05)';
  ctx.font = "bold 900px 'Yu Mincho', serif";
  ctx.textAlign = 'center';
  ctx.fillText('鬼', W / 2, 1500);
  ctx.textAlign = 'left';

  const X = 90;
  ctx.fillStyle = '#c79a54';
  ctx.font = "600 34px 'Montserrat', sans-serif";
  ctx.fillText('O N I', X, 170);
  ctx.fillStyle = '#f2eee8';
  ctx.font = "700 76px 'Montserrat', sans-serif";
  ctx.fillText(fit(ctx, labels.title(period), W - 2 * X), X, 300);

  // The minutes, big and gold.
  ctx.fillStyle = '#a7a3a0';
  ctx.font = "500 36px 'Zen Kaku Gothic New', sans-serif";
  ctx.fillText(labels.minutes, X, 470);
  ctx.fillStyle = '#c79a54';
  ctx.font = "800 190px 'Montserrat', sans-serif";
  ctx.fillText(Math.round(recap.minutes).toLocaleString(lang), X - 6, 650);

  // The top artist and track, each with its cover.
  const row = async (y: number, label: string, title: string, sub: string, track: Track | undefined, round: boolean) => {
    const image = await coverBitmap(track, 400);
    const size = 220;
    ctx.save();
    ctx.beginPath();
    if (round) ctx.arc(X + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    else ctx.roundRect(X, y, size, size, 24);
    ctx.clip();
    if (image) ctx.drawImage(image, X, y, size, size);
    else {
      ctx.fillStyle = '#211816';
      ctx.fillRect(X, y, size, size);
    }
    ctx.restore();
    const tx = X + size + 50;
    const tw = W - tx - X;
    ctx.fillStyle = '#a7a3a0';
    ctx.font = "500 34px 'Zen Kaku Gothic New', sans-serif";
    ctx.fillText(label, tx, y + 60);
    ctx.fillStyle = '#f2eee8';
    ctx.font = "700 60px 'Montserrat', sans-serif";
    ctx.fillText(fit(ctx, title, tw), tx, y + 135);
    if (sub) {
      ctx.fillStyle = '#a7a3a0';
      ctx.font = "500 36px 'Zen Kaku Gothic New', sans-serif";
      ctx.fillText(fit(ctx, sub, tw), tx, y + 190);
    }
  };
  const artist = recap.artists[0];
  const track = recap.tracks[0];
  if (artist) await row(760, labels.artist, artist.artist.name, '', artist.track, true);
  if (track) await row(1060, labels.track, track.track.title, track.track.artists?.map((a) => a.name).join(', ') ?? '', track.track, false);
  if (genre) {
    ctx.fillStyle = '#a7a3a0';
    ctx.font = "500 36px 'Zen Kaku Gothic New', sans-serif";
    ctx.fillText(labels.genre, X, 1420);
    ctx.fillStyle = '#d9272e';
    ctx.font = "700 72px 'Montserrat', sans-serif";
    ctx.fillText(fit(ctx, genre, W - 2 * X), X, 1505);
  }

  // The mark at the foot.
  ctx.fillStyle = '#49403d';
  ctx.fillRect(X, 1700, W - 2 * X, 2);
  ctx.fillStyle = '#f2eee8';
  ctx.font = "700 40px 'Montserrat', sans-serif";
  ctx.fillText('Oni', X, 1790);
  ctx.fillStyle = '#d9272e';
  ctx.font = "bold 56px 'Yu Mincho', serif";
  ctx.textAlign = 'right';
  ctx.fillText('鬼', W - X, 1795);

  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png'));
}
