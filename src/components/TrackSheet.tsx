// "Track details" and "Edit" (your own uploads) from the track menu, as in the official app.

import { useState } from 'react';
import { create } from 'zustand';
import { api } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { useLang, useT } from '../i18n.ts';
import { usePlayer } from '../player/player.ts';
import { errorText, navigate, toast } from '../store.ts';
import { fmtTime, useAsync } from '../ui/util.ts';
import { Spinner } from './Common.tsx';
import { useGenreTitles } from './Mixes.tsx';

type Sheet = { kind: 'info' | 'edit'; track: Track };

const useSheet = create<Sheet | null>(() => null);
const close = () => useSheet.setState(null, true);

export const showTrackInfo = (track: Track) => useSheet.setState({ kind: 'info', track }, true);
export const editUpload = (track: Track) => useSheet.setState({ kind: 'edit', track }, true);

/** Bumped after an upload is renamed: views listing tracks reload. */
export const useTrackEdits = create<{ version: number }>(() => ({ version: 0 }));

export function TrackSheetHost() {
  const sheet = useSheet();
  if (!sheet) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div className="dialog glass track-sheet" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        {sheet.kind === 'info' ? <TrackInfo track={sheet.track} /> : <EditUpload key={sheet.track.id} track={sheet.track} />}
      </div>
    </div>
  );
}

function TrackInfo({ track }: { track: Track }) {
  const t = useT();
  const s = t.trackInfo;
  const genres = useGenreTitles();
  const lang = useLang((l) => l.lang);
  const upload = track.trackSource === 'UGC';
  // Uploads have no catalog card (full-info answers 400): what the list already knows is all there is.
  const { data, loading } = useAsync(() => (upload ? Promise.resolve(track) : api.trackFullInfo(track).catch(() => track)), [track.id]);
  const full = data ?? track;
  const album = full.albums?.[0];
  const lyrics = full.lyricsInfo?.hasAvailableSyncLyrics ? s.lyricsSynced : full.lyricsInfo?.hasAvailableTextLyrics ? s.lyricsText : s.lyricsNone;
  const rows: [string, React.ReactNode][] = [];
  const add = (label: string, value: React.ReactNode) => rows.push([label, value]);
  add(s.artists, full.artists?.map((a) => a.name).join(', ') || '—');
  if (album) {
    const open = () => {
      close();
      navigate({ name: 'album', id: album.id });
    };
    add(
      s.album,
      <a className="link" onClick={open}>
        {album.title}
      </a>,
    );
    const date = album.releaseDate && new Date(album.releaseDate).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
    if (date || album.year) add(s.released, date || album.year);
    if (album.genre) add(s.genre, genres[album.genre] ?? album.genre);
    if (album.labels?.length) add(s.label, album.labels.map((l) => l.name).join(', '));
    if (album.trackPosition && album.trackCount) add(s.position, s.positionOf(album.trackPosition.index, album.trackCount));
  }
  add(s.duration, fmtTime((full.durationMs || 0) / 1000));
  if (full.r128) add(s.loudness, `${full.r128.i.toFixed(1)} LUFS`);
  if (!upload) add(s.lyrics, lyrics);
  if (full.chart?.position) add(s.chart, s.chartPlace(full.chart.position, full.chart.listeners));
  if (full.contentWarning === 'explicit') add(s.age, '18+');
  if (upload) add(s.source, t.menu.uploaded);
  return (
    <>
      <h3>{full.title}</h3>
      {full.version && <p>{full.version}</p>}
      {loading && !data ? (
        <Spinner />
      ) : (
        <dl className="info-rows" data-testid="track-info">
          {rows.map(([k, v]) => (
            <div key={k} className="info-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="dialog-actions">
        <button className="btn ghost" onClick={close}>
          {t.common.close}
        </button>
      </div>
    </>
  );
}

function EditUpload({ track }: { track: Track }) {
  const t = useT();
  const s = t.editTrack;
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState((track.artists || []).map((a) => a.name).join(', '));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const change = { title: title.trim(), artist: artist.trim() };
      await api.changeUpload(track.id, change);
      // The playing queue shows the new name at once; lists reload.
      const artists = change.artist ? [{ id: track.artists?.[0]?.id ?? 0, name: change.artist }] : [];
      usePlayer.setState((p) => ({ queue: p.queue.map((q) => (String(q.id) === String(track.id) ? { ...q, title: change.title, artists } : q)) }));
      useTrackEdits.setState((e) => ({ version: e.version + 1 }));
      toast(s.saved);
      close();
    } catch (e) {
      toast(s.failed(errorText(e)));
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3>{s.title}</h3>
      <label className="field">
        <span className="hint">{s.name}</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus data-testid="edit-title" />
      </label>
      <label className="field">
        <span className="hint">{s.artist}</span>
        <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} data-testid="edit-artist" />
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn ghost" onClick={close}>
          {t.common.cancel}
        </button>
        <button type="submit" className="btn primary" disabled={busy || !title.trim()} data-testid="edit-save">
          {t.common.save}
        </button>
      </div>
    </form>
  );
}
