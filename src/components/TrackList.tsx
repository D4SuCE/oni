import { memo, useEffect, useRef, useState } from 'react';
import { useDragSort } from '../ui/dragSort.ts';
import { ArrowDownToLine, ArrowUp, Ban, GripVertical, CircleCheck, Disc3, Download, Info, Loader2, Pencil, Heart, Link, ListEnd, ListPlus, ListStart, MoreHorizontal, Play, Plus, Radio, Share, Trash2, User } from 'lucide-react';
import type { Track } from '../api/types.ts';
import { artistNames, catalogTrack } from '../api/yandex.ts';
import { tr, useT } from '../i18n.ts';
import { enqueue, offline, playNext, playRadio, toggle, usePlayer } from '../player/player.ts';
import { addToPlaylist, createPlaylist, dislike, errorText, isOwn, navigate, toast, toggleLike, useApp } from '../store.ts';
import { transport } from '../api/client.ts';
import { downloadTrack, offlineState, useCover, useDownloadProgress, useOfflineVersion, type OfflineState } from '../ui/offline.ts';
import { isIos } from '../ui/platform.ts';
import { shareTrack } from '../ui/share.ts';
import { cx, fmtTime } from '../ui/util.ts';
import { ArtistLinks, Cover } from './Common.tsx';
import { trackMatches } from './ListSearch.tsx';
import { askText } from './Dialog.tsx';
import { openMenu, type MenuItem } from './Menu.tsx';
import { editUpload, showTrackInfo } from './TrackSheet.tsx';
import { addToMine } from '../share/mine.ts';

/** A file the user uploaded: marked in lists, with a short menu (its link opens for nobody else). */
const isUpload = (t: Track) => t.trackSource === 'UGC';
/** An upload whose artist is no link: one Yandex has not found in the catalog. */
export const plainArtists = (t: Track) => isUpload(t) && !catalogTrack(t);

export function trackMenu(t: Track, extra: MenuItem[] = []): MenuItem[] {
  const app = useApp.getState();
  const own = app.playlists.filter((p) => isOwn(p));
  // a friend's upload from his Disk (src/share): only "add to mine", as one's own upload
  if (t.share)
    return transport.canUpload
      ? [{ label: tr().shared.toMine, icon: <Plus size={15} />, submenu: own.map((p) => ({ label: p.title, onClick: () => void addToMine(t, p).then(() => toast(tr().shared.added(1, p.title)), (e) => toast(tr().shared.addFailed(t.title, errorText(e)))) })) }, ...extra]
      : extra;
  const liked = app.liked.has(String(t.id));
  const tx = tr();
  const playlistItems: MenuItem[] = [
    {
      label: tx.menu.newPlaylist,
      icon: <Plus size={15} />,
      onClick: async () => {
        const title = await askText(tx.common.newPlaylist, t.title, tx.common.create);
        if (title) addToPlaylist(await createPlaylist(title), t);
      },
    },
    ...(own.length ? [{ label: '', separator: true }] : []),
    ...own.map((p) => ({ label: p.title, onClick: () => addToPlaylist(p, t) })),
  ];
  const like: MenuItem = { label: liked ? tx.menu.unlike : tx.common.like, icon: <Heart size={15} />, onClick: () => toggleLike(t) };
  const dontRecommend: MenuItem = { label: tx.common.dontRecommend, icon: <Ban size={15} />, danger: true, onClick: () => dislike(t) };
  const addTo: MenuItem = { label: tx.menu.addToPlaylist, icon: <ListPlus size={15} />, submenu: playlistItems };
  // Your own upload gets what the official app offers for one: no radio, album, artist or link,
  // none of which exist for a private file.
  const details: MenuItem = { label: tx.menu.details, icon: <Info size={15} />, onClick: () => showTrackInfo(t) };
  const state = offlineState(t.id);
  const download: MenuItem[] = !offline
    ? []
    : state === 'done'
      ? [{ label: tx.menu.removeDownload, icon: <CircleCheck size={15} />, onClick: () => offline?.remove(t.id) }]
      : state === 'busy' || state === 'queued'
        ? [{ label: tx.menu.downloading, icon: <Loader2 size={15} className="spin" /> }]
        : [{ label: tx.menu.download, icon: <Download size={15} />, onClick: () => downloadTrack(t) }];
  if (isUpload(t)) {
    // Found in the catalog by Yandex: its radio and its artist, as for that track (the file plays).
    const found = catalogTrack(t);
    const artist = found?.artists?.[0] && !found.artists[0].various ? found.artists[0] : null;
    const linked: MenuItem[] = found
      ? [
          { label: tx.menu.radio, icon: <Radio size={15} />, onClick: () => playRadio(`track:${found.id}`, `${t.title} — ${artistNames(found)}`) },
          ...(artist
            ? [
                { label: tx.menu.artistRadio, icon: <Radio size={15} />, onClick: () => playRadio(`artist:${artist.id}`, artist.name) },
                { label: tx.menu.goToArtist, icon: <User size={15} />, onClick: () => navigate({ name: 'artist', id: artist.id }) },
              ]
            : []),
          ...(found.albums?.[0]?.id ? [{ label: tx.menu.goToAlbum, icon: <Disc3 size={15} />, onClick: () => navigate({ name: 'album', id: found.albums[0].id }) }] : []),
        ]
      : [];
    return [
      like,
      ...download,
      ...linked,
      dontRecommend,
      addTo,
      { label: tx.menu.edit, icon: <Pencil size={15} />, onClick: () => editUpload(t) },
      details,
      ...(extra.length ? [{ label: '', separator: true }, ...extra] : []),
    ];
  }

  const items: MenuItem[] = [
    { label: tx.menu.playNext, icon: <ListStart size={15} />, onClick: () => playNext(t) },
    { label: tx.menu.radio, icon: <Radio size={15} />, onClick: () => playRadio(`track:${t.id}`, `${t.title} — ${artistNames(t)}`) },
    // The artist's radio, as on the artist's page, without going there (the user asked).
    ...(t.artists?.[0] && !t.artists[0].various
      ? [{ label: tx.menu.artistRadio, icon: <Radio size={15} />, onClick: () => playRadio(`artist:${t.artists[0].id}`, t.artists[0].name) }]
      : []),
    { label: tx.menu.addToQueue, icon: <ListEnd size={15} />, onClick: () => enqueue(t) },
    addTo,
    like,
    ...download,
    { label: tx.menu.share, icon: <Share size={15} />, submenu: [{ label: tx.menu.copyLink, icon: <Link size={15} />, onClick: () => shareTrack(t) }] },
    { label: '', separator: true },
  ];
  if (t.albums?.[0]?.id) items.push({ label: tx.menu.goToAlbum, icon: <Disc3 size={15} />, onClick: () => navigate({ name: 'album', id: t.albums[0].id }) });
  if (t.artists?.[0] && !t.artists[0].various) items.push({ label: tx.menu.goToArtist, icon: <User size={15} />, onClick: () => navigate({ name: 'artist', id: t.artists[0].id }) });
  items.push(details, ...extra);
  items.push({ label: '', separator: true }, dontRecommend);
  return items;
}

interface RowProps {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  liked: boolean;
  showAlbum: boolean;
  onPlay: (index: number) => void;
  onRemove?: (index: number) => void;
  rowMenu?: (t: Track, index: number) => MenuItem[];
  saved: OfflineState;
  /** No network and not downloaded: shown dimmed, as Yandex's app does, and not playable. */
  off?: boolean;
  /** Can be dragged into another place (ui/dragSort.ts). */
  sortable?: boolean;
  /** The iPhone's "Move" mode: a handle to drag by, in place of "…". */
  handle?: boolean;
}

const TrackRow = memo(function TrackRow({ track: t, index, active, playing, liked, showAlbum, onPlay, onRemove, rowMenu, saved, off, sortable, handle }: RowProps) {
  // taken away by Yandex, but downloaded: it plays from the copy (player.ts, `playable`)
  const unavailable = (t.available === false && saved !== 'done') || Boolean(off);
  const tx = useT();
  const cover = useCover(t, 100);
  // Being put in order: a hold is for dragging, not for the menu, and a tap plays nothing.
  const menu = (e: React.MouseEvent) =>
    handle ? e.preventDefault() : openMenu(
      e,
      trackMenu(t, [
        ...(rowMenu?.(t, index) ?? []),
        ...(onRemove ? [{ label: tx.menu.removeFromPlaylist, icon: <Trash2 size={15} />, danger: true, onClick: () => onRemove(index) }] : []),
      ]),
    );
  return (
    <div
      className={cx('track-row', active && 'active', unavailable && 'unavailable')}
      // A double click plays on the desktop; on a phone one tap does (a long press opens the menu).
      onDoubleClick={isIos ? undefined : () => !unavailable && (active ? toggle() : onPlay(index))}
      onClick={isIos ? (e) => !unavailable && !handle && !(e.target as Element).closest('button, a') && (active ? toggle() : onPlay(index)) : undefined}
      onContextMenu={menu}
      data-track-id={t.id}
      data-sort-index={sortable ? index : undefined}
    >
      <div className="tr-num">
        {active && playing ? (
          <span className="eq">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="tr-index">{index + 1}</span>
        )}
        <button className="tr-play" onClick={() => (active ? toggle() : onPlay(index))} disabled={unavailable} title={tx.common.play}>
          <Play size={14} fill="currentColor" />
        </button>
      </div>
      <Cover src={cover} size={40} />
      <div className="tr-main">
        <div className="tr-title">
          {/* In front of the title: a long one cuts off its end, and the mark must stay visible. */}
          {isUpload(t) && (
            <span className="badge upload" title={tx.menu.uploaded} data-testid="upload-badge">
              <ArrowUp size={12} strokeWidth={2.75} />
            </span>
          )}
          {t.title}
          {t.version && <span className="tr-version"> {t.version}</span>}
          {t.contentWarning === 'explicit' && <span className="badge">E</span>}
        </div>
        <div className="tr-artists">
          <ArtistLinks artists={t.artists} plain={isIos || plainArtists(t)} />
        </div>
      </div>
      {showAlbum && (
        <div className="tr-album">
          {t.albums?.[0] && (
            <a className="link" onClick={() => navigate({ name: 'album', id: t.albums[0].id })}>
              {t.albums[0].title}
            </a>
          )}
        </div>
      )}
      <button className={cx('icon-btn tr-like', liked && 'on')} onClick={() => toggleLike(t)} title={tx.common.like}>
        <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
      </button>
      <div className="tr-dur">
        {saved !== 'none' && <DownloadMark id={t.id} saved={saved} label={tx.menu.downloaded} />}
        <span className="tr-time">{fmtTime((t.durationMs || 0) / 1000)}</span>
      </div>
      {handle ? (
        <span className="drag-handle" title={tx.menu.move} data-testid="drag-handle">
          <GripVertical size={18} />
        </span>
      ) : (
        <button className="icon-btn tr-more" onClick={menu} title={tx.common.more}>
          <MoreHorizontal size={18} />
        </button>
      )}
    </div>
  );
});

/**
 * A row's download, as in Yandex's app: an arrow once downloaded, a ring filling while it comes
 * (spinning on the desktop, where the progress is not known), nothing before or while queued
 * (hundreds of spinning rings would cost the page its smoothness). Its own component: only this
 * row redraws as the ring fills.
 */
function DownloadMark({ id, saved, label }: { id: string | number; saved: OfflineState; label: string }) {
  const progress = useDownloadProgress(id);
  if (saved === 'done') return <ArrowDownToLine size={14} className="tr-saved" aria-label={label} data-testid="saved-mark" />;
  if (progress === undefined) return saved === 'busy' ? <span className="tr-saved dl-ring waiting" data-testid="downloading-mark" /> : null;
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg className="tr-saved dl-ring" width={14} height={14} viewBox="0 0 16 16" data-testid="downloading-mark" data-progress={progress.toFixed(2)}>
      <circle cx={8} cy={8} r={r} className="dl-ring-track" />
      <circle cx={8} cy={8} r={r} className="dl-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} transform="rotate(-90 8 8)" />
    </svg>
  );
}

/** Rows drawn with the page; the rest come this many at a time in the next moments. A tab opened
 * only once all of a long list (Liked, History: hundreds of rows) was drawn, and on the iPhone a tap
 * waited for it (the user, 25.10.2026: "the tab opens with a delay"). */
const FIRST_ROWS = 40;
const MORE_ROWS = 120;

/** How many rows of `total` are drawn: FIRST_ROWS at once, then more after each paint. */
export function useRowsShown(total: number) {
  const [shown, setShown] = useState(FIRST_ROWS);
  useEffect(() => {
    if (shown >= total) return;
    const timer = setTimeout(() => setShown((n) => n + MORE_ROWS), 16);
    return () => clearTimeout(timer);
  }, [shown, total]);
  return shown;
}

export function TrackList({
  tracks,
  onPlay,
  showAlbum = true,
  onRemove,
  rowMenu,
  filter,
  onMove,
  reordering = false,
  onReorderDone,
}: {
  tracks: Track[];
  /** Only rows matching this (ListSearch); they keep their positions in the whole list. */
  filter?: string;
  onPlay: (index: number) => void;
  showAlbum?: boolean;
  onRemove?: (index: number) => void;
  /** Extra menu items for a row (above the standard ones' tail). */
  rowMenu?: (t: Track, index: number) => MenuItem[];
  /** The list can be put in another order (own playlists, Liked): a track taken from `from` goes to `to`. */
  onMove?: (from: number, to: number) => void;
  /** The iPhone's "Move" mode (from the page's "…"): handles to drag by, and "Done" calls this. */
  reordering?: boolean;
  onReorderDone?: () => void;
}) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const liked = useApp((s) => s.liked);
  const offlineNow = useApp((s) => s.offline);
  useOfflineVersion((s) => s.v);
  const tx = useT();
  // Moving tracks: with a mouse a row is dragged by the held left button; on the iPhone "Move" in the
  // page's "…" (a playlist's, Liked's) shows handles to drag by (the user's way for each; it was in
  // a track's menu before 1.6.1). Not while searching the list.
  const list = useRef<HTMLDivElement>(null);
  const sortable = Boolean(onMove) && !filter;
  useDragSort(list, { enabled: sortable && (!isIos || reordering), mode: isIos ? 'handle' : 'row', hold: true, onMove: (from, to) => onMove?.(from, to) });
  // All of them while searching the list or putting it in order.
  const drawn = useRowsShown(tracks.length);
  const limit = filter || reordering ? tracks.length : drawn;
  return (
    <div ref={list} className={cx('track-list', !showAlbum && 'no-album', reordering && 'reordering')}>
      {reordering && (
        <div className="reorder-bar" data-testid="reorder-bar">
          <span>{tx.menu.moveHint}</span>
          <button className="btn primary small" onClick={onReorderDone} data-testid="reorder-done">
            {tx.common.done}
          </button>
        </div>
      )}
      {tracks.map((t, i) =>
        i >= limit || (filter && !trackMatches(t, filter)) ? null : (
          <TrackRow
            key={`${t.id}-${i}`}
            track={t}
            index={i}
            active={t.id === currentId}
            playing={playing}
            liked={liked.has(String(t.id))}
            showAlbum={showAlbum}
            onPlay={onPlay}
            onRemove={onRemove}
            rowMenu={rowMenu}
            saved={offlineState(t.id)}
            off={offlineNow && !offline?.has(t.id)}
            sortable={sortable}
            handle={reordering && sortable}
          />
        ),
      )}
    </div>
  );
}
