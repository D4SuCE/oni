// Backups of the library on Yandex Disk (src/backup): a day's copy, and from it a playlist back (as a
// new one) or Liked's tracks that left it.

import { Heart, ListMusic, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox, Spinner } from '../components/Common.tsx';
import { confirmDialog } from '../components/Dialog.tsx';
import { useLang, useT } from '../i18n.ts';
import { list, read, restoreLikes, restorePlaylist } from '../backup/backup.ts';
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
              {copy.data.playlists.map((p) => (
                <div key={String(p.kind)} className="shared-row">
                  <ListMusic size={18} />
                  <div className="import-src">
                    <div className="import-title">{p.title}</div>
                    <div className="import-sub">{t.count.tracks(p.tracks.length)}</div>
                  </div>
                  <button
                    className="btn ghost small"
                    disabled={busy !== null || !p.tracks.length}
                    onClick={() =>
                      run(String(p.kind), async () => {
                        const made = await restorePlaylist(copy.data!, p.kind, s.copyTitle(p.title, date(picked)));
                        await refreshPlaylists();
                        toast(s.playlistBack(made.title));
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
