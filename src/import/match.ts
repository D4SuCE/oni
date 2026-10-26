// Playlist import, step two: is a track Yandex found the one from the list? Pure (tested offline,
// tests/import.test.ts).
//
// The title (without what services add — "feat. …", "- Remastered 2011", "(Official Video)"),
// the artists, the length, and the kind of version (a remix, a live recording, sped up…: one the
// list did not ask for is a different track) are weighed. A score of 0.85 and over is taken as
// it is ("found"); 0.6 and over is offered with other candidates to choose from ("maybe").

import type { Track } from '../api/types.ts';
import type { SourceTrack } from './sources.ts';

export type MatchState = 'found' | 'maybe' | 'none';

export const FOUND = 0.85;
export const MAYBE = 0.6;

/** Lower case, no accents, ё as е, only letters and digits split by single spaces. */
export function norm(s: string) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Kinds of versions: a track of one kind is not the same as one of another (or of none). */
const KINDS: [string, RegExp][] = [
  ['remix', /\bremix\b|\bремикс\b|\bmix\b(?!ed)/],
  ['live', /\blive\b|\bconcert\b|\bлайв\b|\bживьем\b/],
  ['acoustic', /\bacoustic\b|\bакустик/],
  ['speed', /\bsped up\b|\bspeed up\b|\bspeedup\b|\bnightcore\b|\bускор/],
  ['slowed', /\bslowed\b|\breverb\b|\bзамедл/],
  ['instrumental', /\binstrumental\b|\bминус\b|\bkaraoke\b|\bкараоке\b/],
  ['cover', /\bcover\b|\bкавер\b/],
];

function kinds(text: string) {
  const n = norm(text);
  return new Set(KINDS.filter(([, re]) => re.test(n)).map(([k]) => k));
}

/** The title alone: no featured artists, no "(Official Video)", no "- Remastered 2011". */
export function baseTitle(title: string) {
  return norm(
    title
      // brackets that name a version or an extra, and featured artists
      .replace(/[([](?:[^)\]]*?\b(?:feat|ft|with|prod|official|video|audio|lyrics?|lyric video|visualizer|remaster(?:ed)?|explicit|clean|clip|клип|премьера|hd|hq|4k|mv)\b[^)\]]*)[)\]]/gi, ' ')
      .replace(/\s(?:feat|ft)\.?\s.*$/i, ' ')
      // " - Remastered 2011", " - Radio Edit", " - From the film …"
      .replace(/\s[-–—]\s(?:.*\b(?:remaster(?:ed)?|edit|version|mono|stereo|from|single|bonus|deluxe)\b.*)$/i, ' '),
  );
}

function words(s: string) {
  return new Set(s.split(' ').filter(Boolean));
}

/** 0…1: the same title, one inside the other (a subtitle dropped), or shared words. */
function titleScore(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const wa = words(a);
  const wb = words(b);
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common / Math.max(wa.size, wb.size);
}

/** 0…1: any artist the same; an artist's name in the list's title (YouTube's "Artist - Title"). */
function artistScore(src: SourceTrack, t: Track) {
  const theirs = (t.artists ?? []).map((a) => norm(a.name)).filter(Boolean);
  if (!theirs.length) return 0.5;
  const ours = src.artists.map(norm).filter(Boolean);
  if (!ours.length) return norm(src.title).includes(theirs[0]) ? 1 : 0.5;
  if (ours.some((a) => theirs.includes(a))) return 1;
  // "The Weeknd" / "Weeknd", "Би-2" / "Би 2", a channel "ArtistVEVO" — most of the name, not a
  // part of another's ("Tyler" of "Eddy Tyler", "Future" of "Future Club Hitmakers")
  const close = (a: string, b: string) => {
    const [x, y] = [a.replace(/\s/g, ''), b.replace(/\s/g, '')].sort((p, q) => p.length - q.length);
    return y.includes(x) && x.length >= 0.6 * y.length;
  };
  const loose = ours.some((a) => theirs.some((b) => close(a, b)));
  if (loose) return 0.85;
  if (theirs.some((b) => norm(src.title).includes(b))) return 0.9;
  return 0;
}

/** 0…1, or null with a length unknown on either side. */
function lengthScore(src: SourceTrack, t: Track) {
  if (!src.durationMs || !t.durationMs) return null;
  const d = Math.abs(src.durationMs - t.durationMs) / 1000;
  return d <= 3 ? 1 : d <= 8 ? 0.8 : d <= 20 ? 0.4 : 0;
}

/**
 * How likely `t` is the list's track (0…1). `videos`: the list's lengths are a video's (YouTube:
 * an intro, a skit — a minute more is common), so the length hardly counts.
 */
export function score(src: SourceTrack, t: Track, videos = false) {
  const full = `${t.title} ${t.version ?? ''}`;
  let title = titleScore(baseTitle(src.title), baseTitle(t.title));
  // a YouTube title holds the artist too ("Artist - Title"): the part after the dash
  if (title < 0.8 && /\s[-–—]\s/.test(src.title)) title = Math.max(title, titleScore(baseTitle(src.title.split(/\s[-–—]\s/).slice(1).join(' ')), baseTitle(t.title)));
  const artist = artistScore(src, t);
  const length = videos ? null : lengthScore(src, t);
  let s = length === null ? 0.55 * title + 0.45 * artist : 0.45 * title + 0.35 * artist + 0.2 * length;
  // the same title by the same artist is the track, unless its length is far off (another cut)
  if (title >= 0.9 && artist >= 0.85 && (length === null || length >= 0.4)) s = Math.max(s, 0.9);
  // a version the list did not ask for (or did, and this is not it)
  const want = kinds(src.title);
  const have = kinds(full);
  const differ = [...want].some((k) => !have.has(k)) || [...have].some((k) => !want.has(k));
  if (differ) s -= 0.3;
  // another title, or another artist with the same title (a cover, a namesake): not the track
  if (title < 0.5 || artist === 0) s = Math.min(s, 0.5);
  return Math.max(0, Math.min(1, s));
}

export interface Match {
  state: MatchState;
  /** The best candidate first. */
  candidates: { track: Track; score: number }[];
}

/** The candidates Yandex's search gave, best first, and what the best one is worth. */
export function pick(src: SourceTrack, found: Track[], videos = false): Match {
  const seen = new Set<string>();
  const candidates = found
    .filter((t) => t.available !== false && !seen.has(t.id) && seen.add(t.id))
    .map((track) => ({ track, score: score(src, track, videos) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const best = candidates[0]?.score ?? 0;
  return { state: best >= FOUND ? 'found' : best >= MAYBE ? 'maybe' : 'none', candidates: candidates.filter((c) => c.score >= 0.35) };
}

/** What to ask Yandex's search: "artist title", the title without its extras. */
export function queryOf(src: SourceTrack) {
  const title = src.title.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s(?:feat|ft)\.?\s.*$/i, '').replace(/\s+/g, ' ').trim();
  return [src.artists[0], title].filter(Boolean).join(' ');
}
