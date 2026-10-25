// Where the music plays from, in the interface language of the moment: a list keeps its label
// (player.ts, ListLabel), and its title is put in words each time it shows.

import { useT } from '../i18n.ts';
import { labelOf, type ListLabel, type Source } from '../player/player.ts';
import { mixTitle, useGenreTitles } from './Mixes.tsx';

/** `(title, label) => text`: the label in words, else the title the list was started with. */
export function useListTitle() {
  const t = useT();
  const genres = useGenreTitles();
  const title = (fallback: string, label?: ListLabel): string => {
    switch (label?.key) {
      case 'liked':
        return t.common.liked;
      case 'downloads':
        return t.nav.downloads;
      case 'history':
        return t.nav.history;
      case 'chart':
        return t.home.chart;
      case 'yearAgo':
        return t.home.yearAgo;
      case 'myWave': {
        const p = label.picks;
        const w = t.wave;
        const picks = p ? [p.context, p.diversity && w.diversity[p.diversity], p.mood && w.moods[p.mood], p.language && w.languages[p.language]] : [];
        return [t.common.myWave, ...picks.filter(Boolean)].join(' · ');
      }
      case 'ownWave':
        return [t.own.title, label.mode && label.mode !== 'balanced' ? t.own.modes[label.mode] : ''].filter(Boolean).join(' · ');
      case 'search':
        return t.search.source(label.arg);
      case 'similar':
        return t.nowPlaying.similarTo(label.arg);
      case 'mix':
        return mixTitle(label.mix, genres);
      case 'radio':
        return t.common.radioOf(label.of ? title(label.title, label.of) : label.title);
      default:
        return fallback;
    }
  };
  return title;
}

/** The player bar's and the Home banner's "from …". */
export function useSourceTitle(source: Source | null) {
  const title = useListTitle();
  return title(source?.kind === 'list' ? source.title : '', labelOf(source));
}
