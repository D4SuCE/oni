// Backups of the library on Yandex Disk (src/backup): a day's copy, and from it a playlist back (as a
// new one, with its own uploads), Liked's tracks that left it, or a device's downloads downloaded here.

import { Download, Heart, HardDriveDownload, ListMusic, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox, Spinner } from '../components/Common.tsx';
import { confirmDialog } from '../components/Dialog.tsx';
import { useLang, useT } from '../i18n.ts';
import { list, read, restoreLikes, restorePlaylist, toDownload } from '../backup/backup.ts';
import { offline } from '../player/player.ts';
import { thisDevice } from '../sync/index.ts';
import { downloadList } from '../ui/offline.ts';
import { errorText, navigate, refreshLibrary, refreshPlaylists, toast } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';

export function BackupView() {
  const t = useT();
  const s = t.backup;
  const lang = useLang((x) => x.lang);
  const days = useAsync(() => list(), []);
  const [day, setDay] = useState<string | null>(null);
  const picked = day ?? days.data?.[0] ?? null;
  const copy = useAsync(() => (picked ? read(picked) : Promise.resolve(null)), [picked]);
  const [busy, setBusy] = useState<string | null>(null);
  const own = (items: { id: string }[]) => items.filter((x) => copy.data?.uploads?.[x.id]).length;
  const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'long' });

  const run = async (key: string, what: () => Promise<void>) => {
    setBusy(key);
    try {
      await what();
    } catch (e) {
      toast(s.failed(errorText(e)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page import-page">
      <header className="page-header compact">
        <div className="page-header-text">
          <div className="kicker">{s.kicker}</div>
          <h1>{s.title}</h1>
          <div className="page-meta">{s.hint}</div>
        </div>
      </header>
      {days.loading ? (
        <Spinner />
      ) : days.error ? (
        <ErrorBox error={days.error} />
      ) : !days.data?.length ? (
        <div className="empty-hint">{s.none}</div>
      ) : (
        <>
          <div className="import-tabs">
            {days.data.map((d) => (
              <button key={d} className={cx('chip', d === picked && 'active')} onClick={() => setDay(d)} data-testid="backup-day">
                {date(d)}
              </button>
            ))}
          </div>
          {copy.loading && <Spinner />}
          {copy.error ? <ErrorBox error={copy.error} /> : null}
          {copy.data && picked && (
            <div className="import-rows">
              <div className="shared-row">
                <Heart size={18} />
                <div className="import-src">
                  <div className="import-title">{t.common.liked}</div>
                  <div className="import-sub">{t.count.tracks(copy.data.likes.length)}</div>
                </div>
                <button
                  className="btn ghost small"
                  disabled={busy !== null}
                  onClick={() =>
                    run('likes', async () => {
                      if (!(await confirmDialog(s.likesTitle, s.likesMessage(date(picked)), s.restore))) return;
                      const n = await restoreLikes(copy.data!);
                      await refreshLibrary();
                      toast(n ? s.likesBack(n) : s.likesSame);
                    })
                  }
                  data-testid="backup-likes"
                >
                  <RotateCcw size={14} /> {busy === 'likes' ? s.restoring : s.restore}
                </button>
              </div>
              {offline &&
                Object.entries(copy.data.downloads ?? {}).map(([id, d]) => (
                  <div key={id} className="shared-row">
                    <HardDriveDownload size={18} />
                    <div className="import-src">
                      <div className="import-title">{s.downloads(id === thisDevice.id ? s.thisDevice : t.sync.deviceName(d.platform))}</div>
                      <div className="import-sub">{t.count.tracks(d.tracks.length)}</div>
                    </div>
                    <button
                      className="btn ghost small"
                      disabled={busy !== null || !d.tracks.length}
                      onClick={() =>
                        run(`dl:${id}`, async () => {
                          const tracks = await toDownload(d.tracks);
                          if (!tracks.length) return void toast(s.allHere);
                          void downloadList(`backup:${picked}:${id}`, tracks, s.downloads(date(picked)));
                          toast(s.downloadStarted(tracks.length));
                        })
                      }
                      data-testid="backup-downloads"
                    >
                      <Download size={14} /> {busy === `dl:${id}` ? s.restoring : s.download}
                    </button>
                  </div>
                ))}
              {copy.data.playlists.map((p) => (
                <div key={String(p.kind)} className="shared-row">
                  <ListMusic size={18} />
                  <div className="import-src">
                    <div className="import-title">{p.title}</div>
                    <div className="import-sub">
                      {t.count.tracks(p.tracks.length)}
                      {own(p.tracks) ? ` · ${s.ownFiles(own(p.tracks))}` : ''}
                    </div>
                  </div>
                  <button
                    className="btn ghost small"
                    disabled={busy !== null || !p.tracks.length}
                    onClick={() =>
                      run(String(p.kind), async () => {
                        const made = await restorePlaylist(copy.data!, p.kind, s.copyTitle(p.title, date(picked)));
                        await refreshPlaylists();
                        toast(made.lost ? s.uploadsLost(made.lost) : s.playlistBack(made.title));
                        navigate({ name: 'playlist', uid: made.uid, kind: made.kind });
                      })
                    }
                    data-testid="backup-playlist"
                  >
                    <RotateCcw size={14} /> {busy === String(p.kind) ? s.restoring : s.restore}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
