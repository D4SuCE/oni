import { ArrowUpDown, Heart, MoreHorizontal, Pencil, Radio, Shuffle, Trash2, Upload } from 'lucide-react';
import { DownloadButton } from '../components/DownloadButton.tsx';
import { useEffect, useRef, useState } from 'react';
import { api, transport } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { playlistCover } from '../api/yandex.ts';
import { ErrorBox, ListPlayButton, PageHeader, Spinner } from '../components/Common.tsx';
import { askText, confirmDialog } from '../components/Dialog.tsx';
import { openMenu, type MenuItem } from '../components/Menu.tsx';
import { useTrackEdits } from '../components/TrackSheet.tsx';
import { SmartShuffleButton } from '../components/SmartShuffle.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { extendList, playRadio, playShuffled, playTracks } from '../player/player.ts';
import { back, errorText, isOwn, refreshPlaylists, samePlaylist, toast, togglePlaylistLike, useApp } from '../store.ts';
import { isIos } from '../ui/platform.ts';
import { cx, fmtTotal, useAsync } from '../ui/util.ts';
import { useListSearch } from '../components/ListSearch.tsx';
import { savedPlaylist } from '../player/offlineLists.ts';
import { loadOrKept, useKeepForOffline } from '../ui/offline.ts';
import { useListTracks } from '../ui/listLoader.ts';
import { moved } from '../ui/dragSort.ts';
import { Loader2 } from 'lucide-react';

/** Up to this many tracks a playlist comes whole in one request; a bigger one in parts. */
const WHOLE = 300;

export function PlaylistView({ uid, kind }: { uid: number | string; kind: number | string }) {
  // An upload renamed from the track menu: show the new name.
  const edits = useTrackEdits((s) => s.version);
  // With no network: the playlist as kept when last seen (its downloaded tracks play).
  const offlineNow = useApp((s) => s.offline);
  const key = `playlist:${uid}:${kind}`;
  // A small playlist (by its count in the library) comes whole; a big or unknown one as ids, its
  // tracks in parts (the user: a friend's 1,600 tracks took seconds to open).
  const known = () => [...useApp.getState().playlists, ...useApp.getState().likedPlaylists].find((p) => samePlaylist(p, { uid, kind }))?.trackCount;
  const { data: pl, loading, error, reload, setData } = useAsync(
    () => loadOrKept(() => api.playlist(uid, kind, (known() ?? Infinity) <= WHOLE), () => savedPlaylist(key)),
    [uid, kind, edits, offlineNow],
  );
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const t = useT();
  const likedPlaylists = useApp((s) => s.likedPlaylists);
  const search = useListSearch();
  /** The iPhone's "Move" mode (from "…"). */
  const [reordering, setReordering] = useState(false);
  const { tracks: loadedTracks, total: listTotal, complete } = useListTracks(pl);
  // Tracks moved by the user show in their new order at once, while Yandex is told (reset with
  // every load of the playlist, which then has that order itself).
  const [movedTracks, setMovedTracks] = useState<{ pl: typeof pl; tracks: Track[] } | null>(null);
  const listTracks = movedTracks && movedTracks.pl === pl ? movedTracks.tracks : loadedTracks;
  useKeepForOffline(key, pl?.title ?? '', pl && complete ? listTracks : null, pl);
  // Playing while the rest comes: it joins the queue.
  useEffect(() => {
    if (listTracks.length) extendList(key, listTracks);
  }, [listTracks, key]);

  if (loading && !pl) return <Spinner />;
  if (error || !pl) return <ErrorBox error={error} onRetry={reload} />;
  const tracks = listTracks;
  const own = isOwn(pl);
  const from = { playlist: `${pl.uid}:${pl.kind}` };
  const saved = likedPlaylists.some((p) => samePlaylist(p, pl));
  const total = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);

  // Own playlists, whole: a track dragged to another place (held mouse button; "Move" on the iPhone).
  const move = async (from: number, to: number) => {
    setMovedTracks({ pl, tracks: moved(tracks, from, to) });
    try {
      const fresh = await api.playlist(pl.uid, pl.kind, false);
      if (String(fresh.tracks?.[from]?.id) !== String(tracks[from]?.id)) throw new Error('the playlist changed meanwhile');
      await api.moveInPlaylist(fresh, from, to);
      refreshPlaylists();
    } catch (e) {
      toast(t.playlist.moveFailed(errorText(e)));
      setMovedTracks(null);
      reload();
    }
  };

  const remove = async (index: number) => {
    try {
      const fresh = await api.playlist(pl.uid, pl.kind);
      await api.removeFromPlaylist(fresh, index);
      reload();
      refreshPlaylists();
    } catch (e) {
      toast(t.playlist.removeFailed(errorText(e)));
    }
  };

  const rename = async () => {
    const title = await askText(t.playlist.renameTitle, pl.title, t.common.save);
    if (!title || title === pl.title) return;
    const updated = await api.renamePlaylist(pl.kind, title);
    setData({ ...pl, title: updated.title });
    refreshPlaylists();
  };

  const destroy = async () => {
    if (!(await confirmDialog(t.playlist.deleteTitle, t.playlist.deleteMessage(pl.title)))) return;
    await api.deletePlaylist(pl.kind);
    await refreshPlaylists();
    back();
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const before = pl.trackCount;
    let ok = 0;
    for (const f of Array.from(files)) {
      setUploading(t.playlist.uploading(f.name));
      try {
        await api.upload({ name: f.name, data: await f.arrayBuffer() }, pl as Playlist);
        ok++;
      } catch (e) {
        toast(`${f.name}: ${errorText(e)}`);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
    if (!ok) return setUploading(null);
    setUploading(t.playlist.processing(t.count.files(ok)));
    // Processing is asynchronous on Yandex's side; poll for up to ~3 minutes.
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 10_000));
      const fresh = await api.playlist(pl.uid, pl.kind).catch(() => null);
      if (fresh && fresh.trackCount >= before + ok) {
        setData(fresh);
        refreshPlaylists();
        toast(t.playlist.uploadDone);
        return setUploading(null);
      }
    }
    setUploading(null);
    toast(t.playlist.uploadPending);
  };

  // "…" on the iPhone: what does not fit its one row of buttons. "Move" puts the list in order
  // (handles on its rows), once it is all in and not narrowed by a search.
  const more: MenuItem[] = [
    { label: t.common.radio, icon: <Radio size={15} />, onClick: () => playRadio(`playlist:${pl.uid}:${pl.kind}`, pl.title) },
    ...(own
      ? [
          ...(complete && tracks.length > 1 && !search.query ? [{ label: t.menu.move, icon: <ArrowUpDown size={15} />, onClick: () => setReordering(true) }] : []),
          ...(transport.canUpload ? [{ label: t.playlist.upload, icon: <Upload size={15} />, onClick: () => fileInput.current?.click() }] : []),
          { label: t.playlist.rename, icon: <Pencil size={15} />, onClick: rename },
          { label: t.playlist.delete, icon: <Trash2 size={15} />, danger: true, onClick: destroy },
        ]
      : [{ label: saved ? t.playlist.unsave : t.playlist.save, icon: <Heart size={15} />, onClick: () => togglePlaylistLike(pl) }]),
  ];
  return (
    <div className="page">
      <PageHeader
        cover={playlistCover(pl, 600)}
        kicker={own ? t.playlist.yours : t.playlist.byOwner(pl.owner?.name || pl.owner?.login || '')}
        title={pl.title}
        meta={
          <>
            {t.count.tracks(pl.trackCount)}
            {complete && total > 0 && `, ${fmtTotal(total)}`}
            {pl.description && <div className="muted desc">{pl.description}</div>}
          </>
        }
        actions={
          <>
            <ListPlayButton list={`playlist:${from.playlist}`} onPlay={() => playTracks(tracks, 0, pl.title, from)} disabled={!tracks.length} />
            {/* These take the whole list: once it is all in. */}
            <button className="btn glass-btn" onClick={() => playShuffled(tracks, pl.title, from)} disabled={!tracks.length || !complete}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
            <SmartShuffleButton tracks={complete ? tracks : []} title={pl.title} from={from} />
            {complete && <DownloadButton listKey={`playlist:${pl.uid}:${pl.kind}`} tracks={tracks} title={pl.title} />}
            {tracks.length > 0 && search.button}
            {/* On the iPhone the rest lives in "…": one row of buttons fits its screen. */}
            {isIos ? (
              <button className="btn glass-btn" onClick={(e) => openMenu(e, more)} title={t.common.more} data-testid="playlist-more">
                <MoreHorizontal size={18} />
              </button>
            ) : (
              <>
                <button className="btn glass-btn" onClick={() => playRadio(`playlist:${pl.uid}:${pl.kind}`, pl.title)} disabled={!tracks.length} data-testid="radio">
                  <Radio size={16} /> {t.common.radio}
                </button>
                {!own && (
                  <button className={cx('icon-btn', saved && 'on like')} onClick={() => togglePlaylistLike(pl)} title={saved ? t.playlist.unsave : t.playlist.save} data-testid="playlist-like">
                    <Heart size={19} fill={saved ? 'currentColor' : 'none'} />
                  </button>
                )}
                {own && (
                  <>
                    {transport.canUpload && (
                      <button className="btn glass-btn" onClick={() => fileInput.current?.click()} disabled={!!uploading} title={t.playlist.uploadHint}>
                        <Upload size={16} /> {t.playlist.upload}
                      </button>
                    )}
                    <button className="icon-btn" onClick={rename} title={t.playlist.rename}>
                      <Pencil size={17} />
                    </button>
                    <button className="icon-btn" onClick={destroy} title={t.playlist.delete}>
                      <Trash2 size={17} />
                    </button>
                  </>
                )}
              </>
            )}
            {own && <input ref={fileInput} type="file" accept="audio/mpeg,.mp3" multiple hidden onChange={(e) => upload(e.target.files)} />}
          </>
        }
      />
      {uploading && (
        <div className="notice glass">
          <Spinner label={uploading} />
        </div>
      )}
      {search.field}
      {tracks.length ? (
        <TrackList
          tracks={tracks}
          filter={search.query}
          onPlay={(i) => playTracks(tracks, i, pl.title, from)}
          onRemove={own ? remove : undefined}
          onMove={own && complete ? move : undefined}
          reordering={reordering}
          onReorderDone={() => setReordering(false)}
        />
      ) : complete ? (
        <div className="empty-hint">{own ? t.playlist.emptyOwn : t.playlist.empty}</div>
      ) : null}
      {!complete && (
        <div className="list-loading" data-testid="list-loading">
          <Loader2 size={16} className="spin" /> {t.playlist.loadingMore(tracks.length, listTotal)}
        </div>
      )}
    </div>
  );
}
