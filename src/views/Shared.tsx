// A friend's own uploads (src/share): his playlists of them, as in his Oni, played from his Yandex
// Disk; "+ Mine" puts a track into a playlist of one's own, as one's own upload (the user,
// 26.10.2026). Reached from a playlist of his, by the button his Oni's hidden mark brings.

import { ArrowDownToLine, Check, Download, Loader2, Pause, Play, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { transport } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { ErrorBox, ListPlayButton, Spinner } from '../components/Common.tsx';
import { askText } from '../components/Dialog.tsx';
import { openMenu } from '../components/Menu.tsx';
import { useT } from '../i18n.ts';
import { offline, playTracks, toggle, usePlayer } from '../player/player.ts';
import { addToMine } from '../share/mine.ts';
import { asTrack, readShared } from '../share/shared.ts';
import { createPlaylist, errorText, isOwn, toast, useApp } from '../store.ts';
import { downloadShared, useOfflineVersion } from '../ui/offline.ts';
import { cx, fmtTime, fmtTotal, useAsync } from '../ui/util.ts';

/**
 * "Add all to mine" and "Download" of a friend's playlist while they run, by key: their progress,
 * and a press then stops them after the track under way, as a list's Download does (the user,
 * 27.10.2026: neither could be stopped). Kept outside the page: left and come back to, it still
 * shows them.
 */
const useJobs = create<Record<string, { done: number; total: number }>>(() => ({}));
/** The tracks being fetched now, for their row's spinner. */
const useFetching = create<Record<string, true>>(() => ({}));
const stopping = new Set<string>();

/** `step` on each track in turn; false when stopped before the end. */
async function runJob(key: string, list: Track[], step: (x: Track) => Promise<void>) {
  useJobs.setState({ [key]: { done: 0, total: list.length } });
  try {
    for (const [i, x] of list.entries()) {
      if (stopping.has(key)) return false;
      await step(x);
      useJobs.setState({ [key]: { done: i + 1, total: list.length } });
    }
    return true;
  } finally {
    stopping.delete(key);
    useJobs.setState((s) => {
      const { [key]: _, ...rest } = s;
      return rest;
    }, true);
  }
}

async function fetchOne(x: Track) {
  useFetching.setState({ [x.id]: true });
  try {
    await downloadShared(x);
  } finally {
    useFetching.setState((f) => {
      const { [x.id]: _, ...rest } = f;
      return rest;
    }, true);
  }
}

export function SharedView({ link, owner }: { link: string; owner?: string }) {
  const t = useT();
  const s = t.shared;
  const { data, loading, error, setData } = useAsync(() => readShared(link, (r) => transport.request(r)), [link]);
  // the owner's Oni still putting tracks there: looked at again every 10 s, the new ones show
  const pending = data?.pending ?? 0;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void readShared(link, (r) => transport.request(r)).then(setData, () => {}), 10_000);
    return () => clearInterval(timer);
  }, [link, pending, setData]);
  const [open, setOpen] = useState(0);
  // per track: being added (spinner), added (a tick)
  const [adding, setAdding] = useState<Record<string, 'busy' | 'done'>>({});
  const current = usePlayer((p) => p.queue[p.index]?.id);
  const playing = usePlayer((p) => p.playing);
  // downloads: kept on this device, to play with no network (the files come from the owner's Disk)
  useOfflineVersion((v) => v.v);
  const fetching = useFetching();
  const jobs = useJobs();
  // one's playlists for "+ Mine", a new one among them as soon as it is made
  const playlists = useApp((a) => a.playlists);
  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error ?? new Error(s.gone)} />;
  const name = data.owner.name || owner || '';
  const pl = data.playlists[Math.min(open, data.playlists.length - 1)];
  const tracks: Track[] = pl ? pl.tracks.map((x) => asTrack(x, link, name)) : [];
  const total = tracks.reduce((n, x) => n + (x.durationMs || 0), 0);
  const own = playlists.filter((p) => isOwn(p));
  // the list this page plays as: Play is Pause while it plays (it started it over: the user, 27.10.2026)
  const list = pl ? `share:${link}:${pl.kind}` : '';
  const play = (i: number) => playTracks(tracks, i, s.listTitle(name, pl!.title), undefined, { list });
  const addKey = `add:${list}`;
  const downloadKey = `download:${list}`;
  const addJob = jobs[addKey];
  const downloadJob = jobs[downloadKey];
  const allKept = Boolean(offline) && tracks.length > 0 && tracks.every((x) => offline!.has(x.id));

  const add = async (all: Track[], target: Playlist) => {
    let done = 0;
    const step = async (x: Track) => {
      setAdding((a) => ({ ...a, [x.id]: 'busy' }));
      try {
        await addToMine(x, target);
        done++;
        setAdding((a) => ({ ...a, [x.id]: 'done' }));
      } catch (err) {
        setAdding((a) => {
          const { [x.id]: _, ...rest } = a;
          return rest;
        });
        throw new Error(s.addFailed(x.title, errorText(err)));
      }
    };
    try {
      // one track: nothing to show the progress of, nor to stop
      const through = all.length === 1 ? (await step(all[0]), true) : await runJob(addKey, all, step);
      toast(through ? s.added(done, target.title) : s.addStopped(done, target.title));
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const download = async (all: Track[]) => {
    try {
      if (all.length === 1) return await fetchOne(all[0]);
      toast((await runJob(downloadKey, all, fetchOne)) ? t.downloads.listDone(all.length) : t.downloads.cancelled);
    } catch (err) {
      toast(t.downloads.failedOne(errorText(err)));
    }
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
          <div className="page-meta">
            {s.meta(t.count.tracks(new Set(data.playlists.flatMap((p) => p.tracks.map((x) => x.id))).size), data.playlists.length)}
            {pending > 0 && <span data-testid="shared-pending"> · {s.pending(t.count.tracks(pending))}</span>}
          </div>
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
      {!pl && <div className="empty-hint">{pending ? s.empty : s.gone}</div>}
      {pl && (
        <>
          <div className="page-actions">
            <ListPlayButton list={list} onPlay={() => play(0)} disabled={!tracks.length} testId="shared-play" />
            {transport.canUpload &&
              (addJob ? (
                <button className="btn glass-btn busy" onClick={() => stopping.add(addKey)} title={s.stopAdding} data-testid="shared-add-all" data-busy>
                  <Loader2 size={16} className="spin" /> {s.adding(addJob.done, addJob.total)}
                  <X size={15} />
                </button>
              ) : (
                <button className="btn glass-btn" onClick={(e) => choose(e, tracks)} disabled={!tracks.length} data-testid="shared-add-all">
                  <Plus size={16} /> {s.addAll}
                </button>
              ))}
            {offline &&
              (downloadJob ? (
                <button className="btn glass-btn busy" onClick={() => stopping.add(downloadKey)} title={t.downloads.cancel} data-testid="shared-download-all" data-busy>
                  <Loader2 size={16} className="spin" /> {t.downloads.progress(downloadJob.done, downloadJob.total)}
                  <X size={15} />
                </button>
              ) : (
                <button className="btn glass-btn" onClick={() => void download(tracks)} disabled={!tracks.length || allKept} data-testid="shared-download-all">
                  {allKept ? <Check size={16} /> : <Download size={16} />} {allKept ? t.downloads.done : t.downloads.download}
                </button>
              ))}
            <span className="muted">
              {t.count.tracks(tracks.length)}
              {total > 0 && `, ${fmtTotal(total)}`}
            </span>
          </div>
          <div className="import-rows">
            {tracks.map((x, i) => {
              const active = current === x.id;
              return (
                <div key={x.id} className={cx('shared-row', active && 'playing')} data-testid="shared-row">
                  {/* playing: the bars, as a track list shows them (Pause under the pointer) */}
                  <button className="icon-btn shared-row-play" onClick={() => (active ? toggle() : play(i))} title={active && playing ? t.player.pause : t.common.play}>
                    {active && playing ? (
                      <>
                        <span className="eq">
                          <i />
                          <i />
                          <i />
                        </span>
                        <Pause size={16} fill="currentColor" className="shared-pause" />
                      </>
                    ) : (
                      <Play size={16} />
                    )}
                  </button>
                  <div className="import-src">
                    <div className="import-title">{x.title}</div>
                    <div className="import-sub">
                      {x.artists.map((a) => a.name).join(', ')}
                      {x.durationMs ? ` · ${fmtTime(x.durationMs / 1000)}` : ''}
                    </div>
                  </div>
                  {offline && (
                    <button className="icon-btn" disabled={Boolean(fetching[x.id]) || offline.has(x.id)} onClick={() => void download([x])} title={offline.has(x.id) ? t.menu.downloaded : t.menu.download} data-testid="shared-download">
                      {fetching[x.id] ? <Loader2 size={15} className="spin" /> : offline.has(x.id) ? <Check size={15} /> : <ArrowDownToLine size={15} />}
                    </button>
                  )}
                  {transport.canUpload &&
                    (adding[x.id] === 'done' ? (
                      <span className="import-taken">
                        <Check size={15} /> <span className="btn-label">{s.addedOne}</span>
                      </span>
                    ) : (
                      <button className="btn ghost small shared-add" disabled={adding[x.id] === 'busy'} onClick={(e) => choose(e, [x])} title={s.toMine} data-testid="shared-add">
                        {adding[x.id] === 'busy' ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} <span className="btn-label">{s.addOne}</span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
