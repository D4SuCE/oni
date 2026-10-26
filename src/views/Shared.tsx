// A friend's own uploads (src/share): his playlists of them, as in his Oni, played from his Yandex
// Disk; "+ Mine" puts a track into a playlist of one's own, as one's own upload (the user,
// 26.10.2026). Reached from a playlist of his, by the button his Oni's hidden mark brings.

import { ArrowDownToLine, Check, Download, Loader2, Play, Plus } from 'lucide-react';
import { useState } from 'react';
import { transport } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { ErrorBox, Spinner } from '../components/Common.tsx';
import { askText } from '../components/Dialog.tsx';
import { openMenu } from '../components/Menu.tsx';
import { useT } from '../i18n.ts';
import { offline, playTracks, toggle, usePlayer } from '../player/player.ts';
import { addToMine } from '../share/mine.ts';
import { asTrack, readShared } from '../share/shared.ts';
import { createPlaylist, errorText, isOwn, toast, useApp } from '../store.ts';
import { downloadShared, useOfflineVersion } from '../ui/offline.ts';
import { cx, fmtTime, fmtTotal, useAsync } from '../ui/util.ts';

export function SharedView({ link, owner }: { link: string; owner?: string }) {
  const t = useT();
  const s = t.shared;
  const { data, loading, error } = useAsync(() => readShared(link, (r) => transport.request(r)), [link]);
  const [open, setOpen] = useState(0);
  // per track: being added (spinner), added (a tick)
  const [adding, setAdding] = useState<Record<string, 'busy' | 'done'>>({});
  const playing = usePlayer((p) => (p.playing ? p.queue[p.index]?.id : undefined));
  // downloads: kept on this device, to play with no network (the files come from the owner's Disk)
  useOfflineVersion((v) => v.v);
  const [fetching, setFetching] = useState<Set<string>>(new Set());
  const download = async (list: Track[]) => {
    for (const x of list) {
      if (offline?.has(x.id)) continue;
      setFetching((f) => new Set(f).add(x.id));
      try {
        await downloadShared(x);
      } catch (err) {
        toast(t.downloads.failedOne(errorText(err)));
        return;
      } finally {
        setFetching((f) => {
          const n = new Set(f);
          n.delete(x.id);
          return n;
        });
      }
    }
  };
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? new Error(s.gone)} />;
  const name = data.owner.name || owner || '';
  const pl = data.playlists[Math.min(open, data.playlists.length - 1)];
  const tracks: Track[] = pl ? pl.tracks.map((x) => asTrack(x, link, name)) : [];
  const total = tracks.reduce((n, x) => n + (x.durationMs || 0), 0);
  const own = useApp.getState().playlists.filter((p) => isOwn(p));

  const add = async (list: Track[], target: Playlist) => {
    for (const x of list) {
      setAdding((a) => ({ ...a, [x.id]: 'busy' }));
      try {
        await addToMine(x, target);
        setAdding((a) => ({ ...a, [x.id]: 'done' }));
      } catch (err) {
        setAdding((a) => {
          const { [x.id]: _, ...rest } = a;
          return rest;
        });
        toast(s.addFailed(x.title, errorText(err)));
        return;
      }
    }
    toast(s.added(list.length, target.title));
  };
  const choose = (e: React.MouseEvent, list: Track[]) =>
    openMenu(e, [
      {
        label: t.menu.newPlaylist,
        icon: <Plus size={15} />,
        onClick: async () => {
          const title = await askText(t.common.newPlaylist, pl?.title ?? '', t.common.create);
          if (title) void add(list, await createPlaylist(title));
        },
      },
      ...(own.length ? [{ label: '', separator: true }] : []),
      ...own.map((p) => ({ label: p.title, onClick: () => void add(list, p) })),
    ]);

  return (
    <div className="page shared-page">
      <header className="page-header compact">
        <div className="page-header-text">
          <div className="kicker">{s.kicker(name)}</div>
          <h1>{s.title}</h1>
          <div className="page-meta">{s.meta(t.count.tracks(new Set(data.playlists.flatMap((p) => p.tracks.map((x) => x.id))).size), data.playlists.length)}</div>
        </div>
      </header>
      {data.playlists.length > 1 && (
        <div className="import-tabs">
          {data.playlists.map((p, i) => (
            <button key={String(p.kind)} className={cx('chip', i === open && 'active')} onClick={() => setOpen(i)} data-testid="shared-playlist">
              {p.title} · {p.tracks.length}
            </button>
          ))}
        </div>
      )}
      {pl && (
        <>
          <div className="page-actions">
            <button className="btn primary" onClick={() => playTracks(tracks, 0, s.listTitle(name, pl.title))} disabled={!tracks.length} data-testid="shared-play">
              <Play size={16} /> {t.common.play}
            </button>
            {transport.canUpload && (
              <button className="btn glass-btn" onClick={(e) => choose(e, tracks)} disabled={!tracks.length}>
                <Plus size={16} /> {s.addAll}
              </button>
            )}
            {offline && (
              <button className="btn glass-btn" onClick={() => void download(tracks)} disabled={!tracks.length || fetching.size > 0 || tracks.every((x) => offline!.has(x.id))} data-testid="shared-download-all">
                {tracks.length && tracks.every((x) => offline!.has(x.id)) ? <Check size={16} /> : <Download size={16} />} {tracks.length && tracks.every((x) => offline!.has(x.id)) ? t.downloads.done : t.downloads.download}
              </button>
            )}
            <span className="muted">
              {t.count.tracks(tracks.length)}
              {total > 0 && `, ${fmtTotal(total)}`}
            </span>
          </div>
          <div className="import-rows">
            {tracks.map((x, i) => (
              <div key={x.id} className={cx('shared-row', playing === x.id && 'playing')} data-testid="shared-row">
                <button className="icon-btn" onClick={() => (playing === x.id ? toggle() : playTracks(tracks, i, s.listTitle(name, pl.title)))} title={t.common.play}>
                  <Play size={16} />
                </button>
                <div className="import-src">
                  <div className="import-title">{x.title}</div>
                  <div className="import-sub">
                    {x.artists.map((a) => a.name).join(', ')}
                    {x.durationMs ? ` · ${fmtTime(x.durationMs / 1000)}` : ''}
                  </div>
                </div>
                {offline && (
                  <button className="icon-btn" disabled={fetching.has(x.id) || offline.has(x.id)} onClick={() => void download([x])} title={offline.has(x.id) ? t.menu.downloaded : t.menu.download} data-testid="shared-download">
                    {fetching.has(x.id) ? <Loader2 size={15} className="spin" /> : offline.has(x.id) ? <Check size={15} /> : <ArrowDownToLine size={15} />}
                  </button>
                )}
                {transport.canUpload &&
                  (adding[x.id] === 'done' ? (
                    <span className="import-taken">
                      <Check size={15} /> {s.addedOne}
                    </span>
                  ) : (
                    <button className="btn ghost small" disabled={adding[x.id] === 'busy'} onClick={(e) => choose(e, [x])} data-testid="shared-add">
                      {adding[x.id] === 'busy' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {s.addOne}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
