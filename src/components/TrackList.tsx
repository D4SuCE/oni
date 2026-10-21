import { memo } from 'react';
import { Ban, Disc3, Heart, ListEnd, ListPlus, ListStart, MoreHorizontal, Play, Plus, Radio, Trash2, User } from 'lucide-react';
import type { Track } from '../api/types.ts';
import { trackCover } from '../api/yandex.ts';
import { tr, useT } from '../i18n.ts';
import { enqueue, playNext, playRadio, toggle, usePlayer } from '../player/player.ts';
import { addToPlaylist, createPlaylist, dislike, isOwn, navigate, toggleLike, useApp } from '../store.ts';
import { cx, fmtTime } from '../ui/util.ts';
import { ArtistLinks, Cover } from './Common.tsx';
import { askText } from './Dialog.tsx';
import { openMenu, type MenuItem } from './Menu.tsx';

export function trackMenu(t: Track, extra: MenuItem[] = []): MenuItem[] {
  const app = useApp.getState();
  const own = app.playlists.filter((p) => isOwn(p));
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
  const items: MenuItem[] = [
    { label: tx.menu.playNext, icon: <ListStart size={15} />, onClick: () => playNext(t) },
    { label: tx.menu.radio, icon: <Radio size={15} />, onClick: () => playRadio(`track:${t.id}`, t.title) },
    { label: tx.menu.addToQueue, icon: <ListEnd size={15} />, onClick: () => enqueue(t) },
    { label: tx.menu.addToPlaylist, icon: <ListPlus size={15} />, submenu: playlistItems },
    { label: liked ? tx.menu.unlike : tx.common.like, icon: <Heart size={15} />, onClick: () => toggleLike(t) },
    { label: '', separator: true },
  ];
  if (t.albums?.[0]?.id) items.push({ label: tx.menu.goToAlbum, icon: <Disc3 size={15} />, onClick: () => navigate({ name: 'album', id: t.albums[0].id }) });
  if (t.artists?.[0] && !t.artists[0].various) items.push({ label: tx.menu.goToArtist, icon: <User size={15} />, onClick: () => navigate({ name: 'artist', id: t.artists[0].id }) });
  items.push(...extra);
  items.push({ label: '', separator: true }, { label: tx.common.dontRecommend, icon: <Ban size={15} />, danger: true, onClick: () => dislike(t) });
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
}

const TrackRow = memo(function TrackRow({ track: t, index, active, playing, liked, showAlbum, onPlay, onRemove, rowMenu }: RowProps) {
  const unavailable = t.available === false;
  const tx = useT();
  const menu = (e: React.MouseEvent) =>
    openMenu(
      e,
      trackMenu(t, [
        ...(rowMenu?.(t, index) ?? []),
        ...(onRemove ? [{ label: tx.menu.removeFromPlaylist, icon: <Trash2 size={15} />, danger: true, onClick: () => onRemove(index) }] : []),
      ]),
    );
  return (
    <div
      className={cx('track-row', active && 'active', unavailable && 'unavailable')}
      onDoubleClick={() => !unavailable && (active ? toggle() : onPlay(index))}
      onContextMenu={menu}
      data-track-id={t.id}
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
      <Cover src={trackCover(t, 100)} size={40} />
      <div className="tr-main">
        <div className="tr-title">
          {t.title}
          {t.version && <span className="tr-version"> {t.version}</span>}
          {t.contentWarning === 'explicit' && <span className="badge">E</span>}
        </div>
        <div className="tr-artists">
          <ArtistLinks artists={t.artists} />
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
      <div className="tr-dur">{fmtTime((t.durationMs || 0) / 1000)}</div>
      <button className="icon-btn tr-more" onClick={menu} title={tx.common.more}>
        <MoreHorizontal size={18} />
      </button>
    </div>
  );
});

export function TrackList({
  tracks,
  onPlay,
  showAlbum = true,
  onRemove,
  rowMenu,
}: {
  tracks: Track[];
  onPlay: (index: number) => void;
  showAlbum?: boolean;
  onRemove?: (index: number) => void;
  /** Extra menu items for a row (above the standard ones' tail). */
  rowMenu?: (t: Track, index: number) => MenuItem[];
}) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const liked = useApp((s) => s.liked);
  return (
    <div className={cx('track-list', !showAlbum && 'no-album')}>
      {tracks.map((t, i) => (
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
        />
      ))}
    </div>
  );
}
