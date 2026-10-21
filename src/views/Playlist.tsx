import { Heart, Pencil, Play, Radio, Shuffle, Trash2, Upload } from 'lucide-react';
import { DownloadButton } from '../components/DownloadButton.tsx';
import { useRef, useState } from 'react';
import { api, transport } from '../api/client.ts';
import type { Playlist } from '../api/types.ts';
import { playlistCover } from '../api/yandex.ts';
import { ErrorBox, PageHeader, Spinner } from '../components/Common.tsx';
import { askText, confirmDialog } from '../components/Dialog.tsx';
import { useTrackEdits } from '../components/TrackSheet.tsx';
import { SmartShuffleButton } from '../components/SmartShuffle.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { useT } from '../i18n.ts';
import { playRadio, playShuffled, playTracks } from '../player/player.ts';
import { back, errorText, isOwn, refreshPlaylists, samePlaylist, toast, togglePlaylistLike, useApp } from '../store.ts';
import { cx, fmtTotal, useAsync } from '../ui/util.ts';

export function PlaylistView({ uid, kind }: { uid: number | string; kind: number | string }) {
  // An upload renamed from the track menu: show the new name.
  const edits = useTrackEdits((s) => s.version);
  const { data: pl, loading, error, reload, setData } = useAsync(() => api.playlist(uid, kind), [uid, kind, edits]);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const t = useT();
  const likedPlaylists = useApp((s) => s.likedPlaylists);

  if (loading && !pl) return <Spinner />;
  if (error || !pl) return <ErrorBox error={error} onRetry={reload} />;
  const tracks = (pl.tracks || []).map((x) => x.track!).filter(Boolean);
  const own = isOwn(pl);
  const from = { playlist: `${pl.uid}:${pl.kind}` };
  const saved = likedPlaylists.some((p) => samePlaylist(p, pl));
  const total = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);

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

  return (
    <div className="page">
      <PageHeader
        cover={playlistCover(pl, 600)}
        kicker={own ? t.playlist.yours : t.playlist.byOwner(pl.owner?.name || pl.owner?.login || '')}
        title={pl.title}
        meta={
          <>
            {t.count.tracks(pl.trackCount)}
            {total > 0 && `, ${fmtTotal(total)}`}
            {pl.description && <div className="muted desc">{pl.description}</div>}
          </>
        }
        actions={
          <>
            <button className="btn primary" onClick={() => playTracks(tracks, 0, pl.title, from)} disabled={!tracks.length}>
              <Play size={16} fill="currentColor" /> {t.common.play}
            </button>
            <button className="btn glass-btn" onClick={() => playShuffled(tracks, pl.title, from)} disabled={!tracks.length}>
              <Shuffle size={16} /> {t.common.shuffle}
            </button>
            <SmartShuffleButton tracks={tracks} title={pl.title} from={from} />
            <DownloadButton listKey={`playlist:${pl.uid}:${pl.kind}`} tracks={tracks} />
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
                <input ref={fileInput} type="file" accept="audio/mpeg,.mp3" multiple hidden onChange={(e) => upload(e.target.files)} />
              </>
            )}
          </>
        }
      />
      {uploading && (
        <div className="notice glass">
          <Spinner label={uploading} />
        </div>
      )}
      {tracks.length ? (
        <TrackList tracks={tracks} onPlay={(i) => playTracks(tracks, i, pl.title, from)} onRemove={own ? remove : undefined} />
      ) : (
        <div className="empty-hint">{own ? t.playlist.emptyOwn : t.playlist.empty}</div>
      )}
    </div>
  );
}
