// "Recap" (History → Recap, stage 7): a month or a year summed up from the play log
// (player/playLog.ts): minutes, the top artists, tracks and genres, as music services do at the
// year's end. Other devices' plays of the last days come in from Yandex's history when it opens.

import { ListPlus, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.ts';
import { trackCover } from '../api/yandex.ts';
import { Cover } from '../components/Common.tsx';
import { useGenreTitles } from '../components/Mixes.tsx';
import { Segmented } from '../components/Wave.tsx';
import { useLang, useT } from '../i18n.ts';
import { playLog, playTracks } from '../player/player.ts';
import { errorText, navigate, refreshPlaylists, toast } from '../store.ts';
import { isIos } from '../ui/platform.ts';

type Period = 'month' | 'last' | 'year';

/** [from, to) of a period, and its name in the interface language. */
function range(period: Period, lang: string) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const month = (yy: number, mm: number) => {
    const name = new Intl.DateTimeFormat(lang, { month: 'long', year: yy === y ? undefined : 'numeric' }).format(new Date(yy, mm, 1));
    return { from: new Date(yy, mm, 1).getTime(), to: new Date(yy, mm + 1, 1).getTime(), name: name[0].toUpperCase() + name.slice(1) };
  };
  if (period === 'month') return month(y, m);
  if (period === 'last') return m ? month(y, m - 1) : month(y - 1, 11);
  return { from: new Date(y, 0, 1).getTime(), to: new Date(y + 1, 0, 1).getTime(), name: String(y) };
}

const TOP_TRACKS = 20;
const TOP_ARTISTS = 8;

export function RecapView() {
  const t = useT();
  const r$ = t.recap;
  const lang = useLang((s) => s.lang);
  const genreTitles = useGenreTitles();
  const [period, setPeriod] = useState<Period>('month');
  // Bumped once other devices' days are in.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api
      .musicHistory()
      .then((days) => {
        playLog.mergeRemote(days.map((d) => ({ date: new Date(`${d.date}T00:00:00`).getTime(), tracks: d.groups.flatMap((g) => g.tracks) })));
        if (live) setVersion((v) => v + 1);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const periods = useMemo(() => (['month', 'last', 'year'] as Period[]).map((p) => [p, range(p, lang).name] as [Period, string]), [lang]);
  const { from, to, name } = range(period, lang);
  // Summed up on every render (a year of plays is a few thousand): `version` re-renders it.
  void version;
  const recap = playLog.recap({ from, to });
  const top = recap.tracks.slice(0, TOP_TRACKS).map((x) => x.track);
  const title = r$.playlistTitle(name);

  const save = async () => {
    try {
      const pl = await api.createPlaylist(title);
      await api.addToPlaylist(pl, top, 0);
      refreshPlaylists();
      toast(r$.saved(title));
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div className="recap" data-testid="recap">
      <div className="recap-head">
        <Segmented options={periods} value={period} onChange={setPeriod} />
      </div>
      {!recap.plays ? (
        <div className="empty-hint" data-testid="recap-empty">
          {r$.empty}
        </div>
      ) : (
        <>
          <div className="recap-stats">
            <div className="recap-stat" data-testid="recap-minutes">
              <b>{Math.round(recap.minutes).toLocaleString(lang)}</b>
              <span>{r$.minutes(Math.round(recap.minutes))}</span>
            </div>
            <div className="recap-stat">
              <b>{recap.trackCount.toLocaleString(lang)}</b>
              <span>{r$.tracks(recap.trackCount)}</span>
            </div>
            <div className="recap-stat">
              <b>{recap.artistCount.toLocaleString(lang)}</b>
              <span>{r$.artists(recap.artistCount)}</span>
            </div>
            <div className="recap-stat">
              <b>{recap.days}</b>
              <span>{r$.days(recap.days)}</span>
            </div>
          </div>

          <div className="lib-actions">
            <button className="btn primary" onClick={() => playTracks(top, 0, title)} data-testid="recap-play">
              <Play size={16} fill="currentColor" /> {r$.play}
            </button>
            <button className="btn glass-btn" onClick={save} data-testid="recap-save">
              <ListPlus size={16} /> {r$.save}
            </button>
          </div>

          <section className="section">
            <div className="section-head">
              <h2>{r$.topArtists}</h2>
            </div>
            <div className="recap-artists">
              {recap.artists.slice(0, TOP_ARTISTS).map((a, i) => (
                <button key={a.artist.id} className="recap-artist" onClick={() => navigate({ name: 'artist', id: a.artist.id })} data-testid="recap-artist">
                  <Cover src={trackCover(a.track, 200)} size={88} round icon="user" />
                  <span className="recap-rank">{i + 1}</span>
                  <span className="recap-name">{a.artist.name}</span>
                  <span className="muted">{r$.plays(a.plays)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>{r$.topTracks}</h2>
            </div>
            <div className="recap-tracks">
              {recap.tracks.slice(0, TOP_TRACKS).map((x, i) => (
                <div
                  key={x.track.id}
                  className="recap-track"
                  // A double click plays on the desktop, one tap on the phone (as track lists do).
                  onDoubleClick={isIos ? undefined : () => playTracks(top, i, title)}
                  onClick={isIos ? () => playTracks(top, i, title) : undefined}
                  data-testid="recap-track"
                >
                  <span className="recap-rank">{i + 1}</span>
                  <Cover src={trackCover(x.track, 100)} size={40} />
                  <div className="tr-main">
                    <div className="tr-title">{x.track.title}</div>
                    <div className="tr-artists">{x.track.artists?.map((a) => a.name).join(', ')}</div>
                  </div>
                  <span className="muted">{r$.times(x.plays)}</span>
                </div>
              ))}
            </div>
          </section>

          {recap.genres.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2>{r$.genres}</h2>
              </div>
              <div className="recap-genres">
                {recap.genres.slice(0, 6).map((g) => (
                  <span key={g.genre} className="recap-genre">
                    {genreTitles[g.genre] ?? g.genre} <span className="muted">{Math.round((g.plays / recap.plays) * 100)}%</span>
                  </span>
                ))}
              </div>
            </section>
          )}
          <div className="hint recap-hint">{r$.hint}</div>
        </>
      )}
    </div>
  );
}
