import { Play } from 'lucide-react';
import { api } from '../api/client.ts';
import { tr, useLang } from '../i18n.ts';
import { playTracks } from '../player/player.ts';
import type { Mix } from '../recs/index.ts';
import { navigate } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';

/** Genre titles in the interface language (mix titles are built from them). */
export function useGenreTitles() {
  const lang = useLang((s) => s.lang);
  return useAsync(() => api.genreTitles(), [lang]).data ?? {};
}

export function mixTitle(mix: Mix, genres: Record<string, string>) {
  const t = tr();
  if (mix.kind === 'discover') return t.recs.discover;
  if (mix.kind === 'radar') return t.recs.radar;
  return t.recs.mix(genres[mix.genre ?? ''] ?? mix.genre ?? '');
}

export const mixSubtitle = (mix: Mix) => tr().recs.andMore(mix.artists.slice(0, 2).join(', '));

/** Kanji on the branded covers: 発見 "discovery", 新作 "new works". */
const SEAL: Record<string, string> = { discover: '発見', radar: '新作' };

/** Cover art: branded for the weekly lists, a 2×2 collage with the genre for taste mixes. */
export function MixArt({ mix, title, big }: { mix: Mix; title: string; big?: boolean }) {
  if (mix.kind !== 'mix') {
    return (
      <div className={cx('mix-art', 'branded', mix.kind, big && 'big')}>
        <span className="mix-seal">{SEAL[mix.kind]}</span>
        <span className="mix-art-title">{title}</span>
      </div>
    );
  }
  const covers = [...mix.covers, ...mix.covers, ...mix.covers, ...mix.covers].slice(0, 4);
  return (
    <div className={cx('mix-art', big && 'big')}>
      <div className="mix-collage">
        {covers.map((c, i) => (
          <img key={i} src={c} alt="" loading="lazy" draggable={false} />
        ))}
      </div>
      <span className="mix-art-title">{title}</span>
    </div>
  );
}

export function MixCard({ mix, genres }: { mix: Mix; genres: Record<string, string> }) {
  const title = mixTitle(mix, genres);
  return (
    <div className="card" onClick={() => navigate({ name: 'mix', id: mix.id })} role="button" tabIndex={0} data-testid="mix-card">
      <div className="card-cover">
        <MixArt mix={mix} title={title} />
        <button
          className="card-play"
          title={tr().common.play}
          onClick={(e) => {
            e.stopPropagation();
            playTracks(mix.tracks, 0, title);
          }}
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>
      <div className="card-title" title={title}>
        {title}
      </div>
      <div className="card-sub">{mixSubtitle(mix)}</div>
    </div>
  );
}
