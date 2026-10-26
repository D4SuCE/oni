// Search inside one list (a playlist, Liked): a button opens a field, and the list narrows to
// tracks whose title, artists or album hold every word typed. Playing one still plays the whole
// list from it: TrackList keeps the rows' own positions (its `filter`).

import { Search, X } from 'lucide-react';
import { useState } from 'react';
import type { Track } from '../api/types.ts';
import { useT } from '../i18n.ts';
import { cx, useEscape } from '../ui/util.ts';

export function trackMatches(t: Track, query: string) {
  const text = [t.title, t.version, ...(t.artists || []).map((a) => a.name), t.albums?.[0]?.title].filter(Boolean).join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

export function useListSearch() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  useEscape(close, open);
  const button = (
    <button className={cx('icon-btn', open && 'on')} onClick={() => (open ? close() : setOpen(true))} title={t.playlist.searchIn} data-testid="list-search">
      <Search size={18} />
    </button>
  );
  const field = open && (
    <div className="list-search glass">
      <Search size={17} />
      <input autoFocus value={query} placeholder={t.playlist.searchIn} onChange={(e) => setQuery(e.target.value)} data-testid="list-search-input" />
      <button className="icon-btn" onClick={close} title={t.common.close}>
        <X size={17} />
      </button>
    </div>
  );
  return { query: open ? query.trim() : '', button, field };
}
