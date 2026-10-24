import { Play } from 'lucide-react';
import { api } from '../api/client.ts';
import { tr, useLang } from '../i18n.ts';
import { playTracks, type MixName } from '../player/player.ts';
import type { Slot } from '../recs/daylist.ts';
import type { Mix } from '../recs/index.ts';
import { navigate } from '../store.ts';
import { cx, useAsync } from '../ui/util.ts';

/** Genre titles in the interface language (mix titles are built from them). */
export function useGenreTitles() {
  const lang = useLang((s) => s.lang);
  return useAsync(() => api.genreTitles(), [lang]).data ?? {};
}

/** What the title is built from, kept with the playing list (not the whole mix with its tracks). */
export const mixName = ({ kind, genre, seedArtist, slot, slotStart, builtAt }: Mix): MixName => ({ kind, genre, seedArtist, slot, slotStart, builtAt });

export function mixTitle(mix: MixName, genres: Record<string, string>) {
  const t = tr();
  if (mix.kind === 'daylist') return t.recs.daylist(mix.slot ?? 'day', new Date(mix.slotStart ?? mix.builtAt).getDay());
  if (mix.kind === 'discover') return t.recs.discover;
  if (mix.kind === 'radar') return t.recs.radar;
  if (mix.kind === 'repeat') return t.recs.repeat;
  if (mix.kind === 'rewind') return t.recs.rewind;
  if (mix.kind === 'because') return t.recs.because(mix.seedArtist ?? '');
  return t.recs.mix(genres[mix.genre ?? ''] ?? mix.genre ?? '');
}

/** "Рэп" → "рэп" mid-sentence, while "J-pop" and "R&B" stay as they are. */
const lowerFirst = (s: string) => (s.length > 1 && s[1] !== s[1].toUpperCase() ? s[0].toLowerCase() + s.slice(1) : s);

/** Leading artists; for the daylist, its character and genres ("Бодрое · рэп, рок"). */
export function mixSubtitle(mix: Mix, genres: Record<string, string>) {
  const t = tr();
  if (mix.kind === 'daylist' && mix.slot) {
    const names = (mix.genres ?? []).map((g) => genres[g]).filter(Boolean).map(lowerFirst);
    return [t.recs.daylistMood[mix.slot], names.join(', ')].filter(Boolean).join(' · ');
  }
  return t.recs.andMore(mix.artists.slice(0, 2).join(', '));
}

/**
 * Brush seals on the covers (the glyphs must be in src/assets/brush.woff2 — scripts/brush-font.py).
 * 発見 discovery, 新作 new works, 反復 repetition, 回想 recollection, 縁 connection; genres: 和風 rap (as in the mockup), 電子 electronic, 代替
 * alternative, 人気 pop, 激音 rock, 鋼鉄 metal, 舞踏 dance, 独立 indie, 民謡 folk, 映画 soundtrack,
 * 古典 classical, 魂歌 R&B, 歌謡 estrada, 反逆 punk, 即興 jazz, 哀歌 blues, 太陽 reggae, 日本 J-pop.
 */
const SEALS: Record<string, string> = {
  discover: '発見',
  radar: '新作',
  repeat: '反復',
  rewind: '回想',
  because: '縁',
  rap: '和風',
  rusrap: '和風',
  foreignrap: '和風',
  electronics: '電子',
  alternative: '代替',
  pop: '人気',
  ruspop: '人気',
  allrock: '激音',
  rock: '激音',
  metal: '鋼鉄',
  dance: '舞踏',
  indie: '独立',
  folk: '民謡',
  soundtrack: '映画',
  classicalmusic: '古典',
  rnb: '魂歌',
  estrada: '歌謡',
  punk: '反逆',
  jazz: '即興',
  blues: '哀歌',
  reggae: '太陽',
  japanesepop: '日本',
};
/** Daylist: 朝 morning, 昼 afternoon, 夕 evening, 夜 night, 深夜 late night. */
const SLOT_SEALS: Record<Slot, string> = { morning: '朝', day: '昼', evening: '夕', night: '夜', late: '深夜' };
const seal = (mix: Mix) =>
  mix.kind === 'daylist' ? SLOT_SEALS[mix.slot ?? 'day'] : (SEALS[mix.kind === 'mix' ? (mix.genre ?? '') : mix.kind] ?? '音楽');

/** Cover art with a brush seal: the oni for discoveries, a red sun for the radar, a duotone collage for mixes. */
export function MixArt({ mix, title, big }: { mix: Mix; title: string; big?: boolean }) {
  const covers = [...mix.covers, ...mix.covers, ...mix.covers, ...mix.covers].slice(0, 4);
  const branded = mix.kind === 'discover' || mix.kind === 'radar';
  return (
    <div className={cx('mix-art', branded && 'branded', mix.kind, big && 'big')}>
      {!branded && (
        <div className="mix-collage">
          {covers.map((c, i) => (
            <img key={i} src={c} alt="" loading="lazy" draggable={false} />
          ))}
        </div>
      )}
      <span className="mix-seal">{seal(mix)}</span>
      <span className="mix-art-title">
        <span>{title}</span>
      </span>
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
            playTracks(mix.tracks, 0, title, undefined, { origin: mix.kind, list: `mix:${mix.id}`, label: { key: 'mix', mix: mixName(mix) } });
          }}
        >
          <Play size={18} fill="currentColor" />
        </button>
      </div>
      <div className="card-title" title={title}>
        {title}
      </div>
      <div className="card-sub">{mixSubtitle(mix, genres)}</div>
    </div>
  );
}
