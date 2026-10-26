// Playlist import (src/import): a link or a list in, Yandex's tracks found, checked by the user,
// a playlist made. The user, 26.10.2026: "found / maybe / not found" to see before anything is made;
// what Yandex has not got — one's own mp3 into the playlist, or Oni looks for it again daily.

import { Check, CircleHelp, FileUp, ListMusic, MoreHorizontal, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { transport } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { Spinner } from '../components/Common.tsx';
import { openMenu } from '../components/Menu.tsx';
import { useT } from '../i18n.ts';
import type { MatchState } from '../import/match.ts';
import { createFrom, findAll, type Row } from '../import/run.ts';
import { fetchSource, ImportError, parseText, sourceOf, type SourceList } from '../import/sources.ts';
import { errorText, navigate, refreshPlaylists } from '../store.ts';
import { cx } from '../ui/util.ts';

type Stage =
  | { kind: 'input'; error?: string }
  | { kind: 'reading' }
  | { kind: 'review'; list: SourceList; rows: (Row | null)[]; creating?: boolean; error?: string }
  | { kind: 'done'; playlist: Playlist; added: number; missing: Row[] };

type Filter = 'all' | MatchState;

const artistsOf = (t: Track) => t.artists.map((a) => a.name).join(', ');

export function ImportView() {
  const t = useT();
  const s = t.transfer;
  const [stage, setStage] = useState<Stage>({ kind: 'input' });
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const file = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  const start = async (input: string, name = '') => {
    const id = ++run.current;
    let list: SourceList;
    if (sourceOf(input)) {
      setStage({ kind: 'reading' });
      try {
        list = await fetchSource(input, (req) => transport.request(req));
      } catch (e) {
        const why = e instanceof ImportError ? s.errors[e.reason] : s.errors.network;
        return run.current === id && setStage({ kind: 'input', error: why });
      }
    } else {
      list = parseText(input, name);
      if (!list.tracks.length) return setStage({ kind: 'input', error: s.errors.empty });
    }
    if (run.current !== id) return;
    setTitle(list.title || s.defaultTitle);
    setFilter('all');
    const rows: (Row | null)[] = list.tracks.map(() => null);
    setStage({ kind: 'review', list, rows: [...rows] });
    await findAll(
      list,
      (i, row) => {
        rows[i] = row;
        if (run.current === id) setStage((st) => (st.kind === 'review' ? { ...st, rows: [...rows] } : st));
      },
      () => run.current !== id,
    );
  };

  const choose = (i: number, track: Track | null) =>
    setStage((st) => {
      if (st.kind !== 'review' || !st.rows[i]) return st;
      const rows = [...st.rows];
      rows[i] = { ...rows[i]!, chosen: track };
      return { ...st, rows };
    });

  if (stage.kind === 'input' || stage.kind === 'reading')
    return (
      <div className="page import-page">
        <header className="page-header compact">
          <div className="page-header-text">
            <div className="kicker">{s.kicker}</div>
            <h1>{s.title}</h1>
          </div>
        </header>
        <p className="import-hint">{s.hint}</p>
        <textarea className="import-input glass" value={text} placeholder={s.placeholder} onChange={(e) => setText(e.target.value)} rows={6} disabled={stage.kind === 'reading'} data-testid="import-input" />
        {stage.kind === 'input' && stage.error && (
          <div className="import-error" data-testid="import-error">
            {stage.error}
          </div>
        )}
        <div className="page-actions">
          <button className="btn primary" disabled={!text.trim() || stage.kind === 'reading'} onClick={() => start(text)} data-testid="import-find">
            {stage.kind === 'reading' ? s.reading : s.find}
          </button>
          <button className="btn ghost" disabled={stage.kind === 'reading'} onClick={() => file.current?.click()}>
            <FileUp size={16} /> {s.file}
          </button>
          <input
            ref={file}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const content = await f.text();
              e.target.value = '';
              setText('');
              start(content, f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </div>
        {stage.kind === 'reading' && <Spinner />}
      </div>
    );

  if (stage.kind === 'done')
    return (
      <div className="page import-page">
        <header className="page-header compact">
          <div className="page-header-text">
            <div className="kicker">{s.kicker}</div>
            <h1>{s.doneTitle}</h1>
          </div>
        </header>
        <p className="import-hint" data-testid="import-done">
          {s.done(stage.playlist.title, t.count.tracks(stage.added))}
        </p>
        {stage.missing.length > 0 && <p className="import-hint">{s.waitingNote(t.count.tracks(stage.missing.length), transport.canUpload ?? false)}</p>}
        <div className="page-actions">
          <button className="btn primary" onClick={() => navigate({ name: 'playlist', uid: stage.playlist.uid, kind: stage.playlist.kind })} data-testid="import-open">
            <ListMusic size={16} /> {s.open}
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              setText('');
              setStage({ kind: 'input' });
            }}
          >
            {s.again}
          </button>
        </div>
        {stage.missing.length > 0 && (
          <div className="import-rows">
            {stage.missing.map((r, i) => (
              <div key={i} className="import-row none">
                <X size={16} className="import-mark" />
                <div className="import-src">
                  <div className="import-title">{r.src.title}</div>
                  <div className="import-sub">{r.src.artists.join(', ')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );

  const { list, rows } = stage;
  const known = rows.filter(Boolean) as Row[];
  const count = (st: MatchState) => known.filter((r) => r.match.state === st).length;
  const chosen = known.filter((r) => r.chosen).length;
  const maybes = rows.map((r, i) => (r?.match.state === 'maybe' && !r.chosen ? i : -1)).filter((i) => i >= 0);
  const searching = known.length < rows.length;
  const tabs: [Filter, string, number][] = [
    ['all', s.all, rows.length],
    ['found', s.found, count('found')],
    ['maybe', s.maybe, count('maybe')],
    ['none', s.none, count('none')],
  ];
  const create = async () => {
    setStage({ ...stage, creating: true, error: undefined });
    try {
      const playlist = await createFrom(title.trim() || s.defaultTitle, known, list.from === 'youtube');
      refreshPlaylists();
      setStage({ kind: 'done', playlist, added: chosen, missing: known.filter((r) => !r.chosen) });
    } catch (e) {
      setStage({ ...stage, creating: false, error: errorText(e) });
    }
  };

  return (
    <div className="page import-page">
      <header className="page-header compact">
        <div className="page-header-text">
          <div className="kicker">
            {s.kicker} · {s.from[list.from]}
          </div>
          <h1>{list.title || s.defaultTitle}</h1>
          <div className="page-meta" data-testid="import-progress">
            {searching ? s.searching(known.length, rows.length) : s.summary(count('found'), count('maybe'), count('none'))}
          </div>
        </div>
      </header>
      {searching && (
        <div className="import-bar">
          <div style={{ width: `${(known.length / Math.max(1, rows.length)) * 100}%` }} />
        </div>
      )}
      {list.partial && <p className="import-hint">{s.partial(s.from[list.from])}</p>}
      <div className="import-tabs">
        {tabs.map(([key, label, n]) => (
          <button key={key} className={cx('chip', filter === key && 'active')} onClick={() => setFilter(key)} data-testid={`import-tab-${key}`}>
            {label} · {n}
          </button>
        ))}
        {maybes.length > 0 && (
          <button className="btn ghost small" onClick={() => maybes.forEach((i) => choose(i, rows[i]!.match.candidates[0].track))} data-testid="import-take-all">
            {s.takeAll(maybes.length)}
          </button>
        )}
      </div>
      <div className="import-rows">
        {rows.map((r, i) => {
          if (filter !== 'all' && r?.match.state !== filter) return null;
          const state = r?.match.state;
          const pickMenu = (e: React.MouseEvent) =>
            r &&
            openMenu(e, [
              ...r.match.candidates.map((c) => ({ label: `${c.track.title}${c.track.version ? ` (${c.track.version})` : ''} — ${artistsOf(c.track)}`, icon: r.chosen?.id === c.track.id ? <Check size={15} /> : undefined, onClick: () => choose(i, c.track) })),
              ...(r.match.candidates.length ? [{ label: '', separator: true }] : []),
              { label: s.skip, icon: <X size={15} />, onClick: () => choose(i, null) },
            ]);
          return (
            <div key={i} className={cx('import-row', state ?? 'pending', r && !r.chosen && 'skipped')} data-testid="import-row" data-state={state ?? 'pending'}>
              {state === 'found' ? <Check size={16} className="import-mark" /> : state === 'maybe' ? <CircleHelp size={16} className="import-mark" /> : state === 'none' ? <X size={16} className="import-mark" /> : <span className="import-mark dot" />}
              <div className="import-src">
                <div className="import-title">{list.tracks[i].title}</div>
                <div className="import-sub">{list.tracks[i].artists.join(', ')}</div>
              </div>
              <div className="import-found">
                {r?.chosen ? (
                  <>
                    <div className="import-title">
                      {r.chosen.title}
                      {r.chosen.version && <span className="tr-version"> {r.chosen.version}</span>}
                    </div>
                    <div className="import-sub">{artistsOf(r.chosen)}</div>
                  </>
                ) : r?.match.state === 'maybe' ? (
                  <button className="btn ghost small" onClick={() => choose(i, r.match.candidates[0].track)} title={`${r.match.candidates[0].track.title} — ${artistsOf(r.match.candidates[0].track)}`}>
                    {s.take}: {r.match.candidates[0].track.title} — {artistsOf(r.match.candidates[0].track)}
                  </button>
                ) : r ? (
                  <div className="import-sub">{s.notFound}</div>
                ) : null}
              </div>
              {r && r.match.candidates.length > 0 && (
                <button className="icon-btn" onClick={pickMenu} title={s.other}>
                  <MoreHorizontal size={18} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="import-create glass">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={s.name} aria-label={s.name} data-testid="import-title" />
        <button className="btn primary" disabled={!chosen || stage.creating || searching} onClick={create} data-testid="import-create">
          {stage.creating ? s.creating : s.create(t.count.tracks(chosen))}
        </button>
      </div>
      {stage.error && <div className="import-error">{stage.error}</div>}
    </div>
  );
}
