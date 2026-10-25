// Lyrics: Yandex's, and where Yandex has none, LRCLIB's (lrclib.net: an open base for players, no
// key, every language; the user's pick, 24.10.2026). Genius is only a button that opens its search in
// the browser (its texts may not be taken). Found or not, the answer is kept (LRCLIB asks not to be
// hammered, and it has to be there with no network): one request per track; "none" is asked again
// after a week. "Wrong lyrics" hides LRCLIB's text for that track for good.

import { create } from 'zustand';
import { api, storage, transport } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { artistNames, catalogTrack } from '../api/yandex.ts';
import { pickLrclib, type LrclibHit } from './lrclib.ts';

export type { Lyrics } from './lrclib.ts';
import type { Lyrics } from './lrclib.ts';

type Entry = Lyrics | { none: number } | { wrong: true };

const KEY = 'lyrics.v1';
/** Kept for this many tracks, the latest asked last (a text is a few KB). */
const KEEP = 1500;
const RECHECK = 7 * 24 * 60 * 60 * 1000;
/** LRCLIB's duration may differ a little from Yandex's (another master, silence at the end). */
const LRCLIB = 'https://lrclib.net/api/search';

let kept: Record<string, Entry> | null = null;
const asked = new Map<string, Promise<Lyrics | null>>();

/** A change in what is known: the lyrics button and tab follow it. */
export const useLyrics = create<{ v: number }>(() => ({ v: 0 }));

function cache() {
  if (!kept) {
    try {
      kept = JSON.parse(storage.getItem(KEY) || '{}') as Record<string, Entry>;
    } catch {
      kept = {};
    }
  }
  return kept;
}

function keep(id: string, entry: Entry) {
  const all = cache();
  delete all[id];
  all[id] = entry;
  const ids = Object.keys(all);
  for (const old of ids.slice(0, Math.max(0, ids.length - KEEP))) delete all[old];
  storage.setItem(KEY, JSON.stringify(all));
  useLyrics.setState((s) => ({ v: s.v + 1 }));
}

/** Yandex's lyrics are there (an upload Yandex has found: the catalog track's). */
const yandexHas = (t: Track) => {
  const s = catalogTrack(t) ?? t;
  return Boolean(s.lyricsInfo?.hasAvailableSyncLyrics || s.lyricsInfo?.hasAvailableTextLyrics);
};

/** Whether the track has lyrics: 'no' only once both Yandex and LRCLIB have said so. */
export function lyricsKnown(t: Track | undefined): 'yes' | 'no' | 'unknown' {
  if (!t) return 'no';
  if (yandexHas(t)) return 'yes';
  const e = cache()[String(t.id)];
  if (!e) return 'unknown';
  if ('text' in e) return 'yes';
  if ('wrong' in e) return 'no';
  return Date.now() - e.none > RECHECK ? 'unknown' : 'no';
}

/** The track's lyrics: kept, Yandex's, or LRCLIB's; null where there are none. */
export function lyricsOf(t: Track): Promise<Lyrics | null> {
  const id = String(t.id);
  const e = cache()[id];
  if (e && 'text' in e) return Promise.resolve(e);
  if (e && 'wrong' in e) return Promise.resolve(null);
  if (e && 'none' in e && Date.now() - e.none < RECHECK && !yandexHas(t)) return Promise.resolve(null);
  let job = asked.get(id);
  if (!job) {
    job = find(t).finally(() => asked.delete(id));
    asked.set(id, job);
  }
  return job;
}

async function find(t: Track): Promise<Lyrics | null> {
  const id = String(t.id);
  if (yandexHas(t)) {
    const y = await api.lyrics(String((catalogTrack(t) ?? t).id));
    if (y) {
      const found: Lyrics = { ...y, source: 'yandex' };
      keep(id, found);
      return found;
    }
  }
  const found = await fromLrclib(t);
  keep(id, found ?? { none: Date.now() });
  return found;
}

/** LRCLIB, searched by the title and the first artist; the one of the same length, synced first. */
async function fromLrclib(t: Track): Promise<Lyrics | null> {
  // An upload Yandex has found goes by the catalog's names (the file's may be anything); its length is the file's.
  const named = catalogTrack(t) ?? t;
  const artist = named.artists?.[0]?.name || artistNames(named);
  if (!named.title || !artist) return null;
  const req = { url: LRCLIB, query: { track_name: named.title, artist_name: artist }, headers: { 'Lrclib-Client': 'Oni (https://github.com/D4SuCE/oni-releases)' } };
  let r = await transport.request<LrclibHit[]>(req);
  // Busy now and then (503): once more a moment later, and not kept as "none" if it still is.
  if (r.status === 503 || r.status === 429) {
    await new Promise((done) => setTimeout(done, 1500));
    r = await transport.request<LrclibHit[]>(req);
  }
  if (!r.ok) throw new Error(`LRCLIB: HTTP ${r.status}`);
  return pickLrclib(Array.isArray(r.data) ? r.data : [], (t.durationMs ?? 0) / 1000);
}

/** "Wrong lyrics": LRCLIB's text is not shown for this track again. */
export function wrongLyrics(t: Track) {
  keep(String(t.id), { wrong: true });
}

/** Genius's search for the song, in the browser. */
export function geniusSearch(t: Track) {
  const url = `https://genius.com/search?q=${encodeURIComponent(`${artistNames(t)} ${t.title}`)}`;
  // The iPhone hands a link that leaves the app to Safari; the desktop's window opens it in the browser.
  if (transport.platform === 'ios') location.href = url;
  else window.open(url, '_blank');
}
