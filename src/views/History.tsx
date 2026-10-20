import { History as HistoryIcon, ListMusic, Waves } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client.ts';
import type { HistoryContext, HistoryGroup } from '../api/types.ts';
import { ErrorBox, Spinner } from '../components/Common.tsx';
import { TrackList } from '../components/TrackList.tsx';
import { tr, useLang, useT } from '../i18n.ts';
import { playTracks, recentPlays, useRecent } from '../player/player.ts';
import type { RecentPlay } from '../player/recent.ts';
import { navigate, samePlaylist, useApp } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';

function dayTitle(date: string, lang: string) {
  const t = tr();
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return t.history.today;
  if (diff === 1) return t.history.yesterday;
  const sameYear = y === today.getFullYear();
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: sameYear ? undefined : 'numeric', weekday: 'long' }).format(day);
}

function contextTitle(c: HistoryContext) {
  const t = tr();
  const app = useApp.getState();
  switch (c.type) {
    case 'wave':
      return c.seeds[0] === 'user:onyourwave' ? t.common.myWave : c.title || t.common.radio;
    case 'playlist': {
      const known = [...app.playlists, ...app.likedPlaylists].find((p) => samePlaylist(p, c));
      if (String(c.uid) === String(app.account?.uid) && String(c.kind) === '3') return t.common.liked;
      return known?.title || c.title || t.common.playlist;
    }
    case 'album':
      return c.title || t.common.album;
    case 'artist':
      return c.title || t.common.artist;
    default:
      return t.history.other;
  }
}

function openContext(c: HistoryContext) {
  if (c.type === 'playlist') {
    if (String(c.kind) === '3' && String(c.uid) === String(useApp.getState().account?.uid)) navigate({ name: 'library', tab: 'tracks' });
    else navigate({ name: 'playlist', uid: c.uid, kind: c.kind });
  } else if (c.type === 'album') navigate({ name: 'album', id: c.id });
  else if (c.type === 'artist') navigate({ name: 'artist', id: c.id });
}

function playContext(c: HistoryContext) {
  if (c.type === 'playlist') return { playlist: `${c.uid}:${c.kind}` };
  if (c.type === 'album') return { album: c.id };
  return undefined;
}

function Group({ group }: { group: HistoryGroup }) {
  const t = useT();
  const title = contextTitle(group.context);
  const linked = ['playlist', 'album', 'artist'].includes(group.context.type);
  const Icon = group.context.type === 'wave' ? Waves : ListMusic;
  return (
    <div className="history-group">
      <div className="history-context">
        <Icon size={15} />
        {linked ? (
          <a className="link" onClick={() => openContext(group.context)}>
            {title}
          </a>
        ) : (
          <span>{title}</span>
        )}
        <span className="muted">· {t.count.tracks(group.tracks.length)}</span>
      </div>
      <TrackList tracks={group.tracks} onPlay={(i) => playTracks(group.tracks, i, title, playContext(group.context))} />
    </div>
  );
}

const localDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Days of local plays, each split into runs of the same source. */
function localDays(plays: RecentPlay[]) {
  const days: { date: string; runs: { source: string; at: number; from?: RecentPlay['from']; tracks: RecentPlay['track'][] }[] }[] = [];
  for (const p of plays) {
    const date = localDate(p.at);
    let day = days[days.length - 1];
    if (day?.date !== date) days.push((day = { date, runs: [] }));
    const run = day.runs[day.runs.length - 1];
    if (run?.source === p.source) {
      run.tracks.push(p.track);
      run.at = p.at;
    } else day.runs.push({ source: p.source, at: p.at, from: p.from, tracks: [p.track] });
  }
  return days;
}

function InThisApp() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  useRecent((s) => s.version);
  const days = localDays(recentPlays.list());
  if (!days.length) return <div className="empty-hint">{t.history.emptyLocal}</div>;
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      {days.map((day) => (
        <section className="section" key={day.date}>
          <div className="section-head">
            <h2 className="history-day">{dayTitle(day.date, lang)}</h2>
          </div>
          {day.runs.map((run, i) => (
            <div className="history-group" key={i}>
              <div className="history-context">
                <ListMusic size={15} />
                <span>{run.source}</span>
                <span className="muted">
                  · {time.format(run.at)} · {t.count.tracks(run.tracks.length)}
                </span>
              </div>
              <TrackList tracks={run.tracks} onPlay={(k) => playTracks(run.tracks, k, run.source, run.from)} />
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

function FromYandex() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const { data, loading, error, reload } = useAsync(() => api.musicHistory(), []);
  return (
    <>
      <p className="hint history-hint">{t.history.hint}</p>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <div className="empty-hint">{t.history.empty}</div>
      ) : (
        data.map((day) => (
          <section className="section" key={day.date}>
            <div className="section-head">
              <h2 className="history-day">{dayTitle(day.date, lang)}</h2>
            </div>
            {day.groups.map((g, i) => (
              <Group key={i} group={g} />
            ))}
          </section>
        ))
      )}
    </>
  );
}

export function HistoryView() {
  const t = useT();
  const [tab, setTab] = useState<'app' | 'yandex'>('app');
  return (
    <div className="page">
      <h1 className="page-title">
        <HistoryIcon size={26} /> {t.nav.history}
      </h1>
      <div className="tabs big">
        <button className={cx('tab', tab === 'app' && 'active')} onClick={() => setTab('app')} data-testid="history-app">
          {t.history.inThisApp}
        </button>
        <button className={cx('tab', tab === 'yandex' && 'active')} onClick={() => setTab('yandex')} data-testid="history-yandex">
          {t.history.allDevices}
        </button>
      </div>
      {tab === 'app' ? <InThisApp /> : <FromYandex />}
    </div>
  );
}
