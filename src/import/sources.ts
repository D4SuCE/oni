// Playlist import, step one: what to bring over — a link to a public playlist (Spotify, Apple
// Music, YouTube, YouTube Music), a pasted list ("Artist — Title" a line), or a file (a CSV such
// as Exportify writes, or plain text). The user, 26.10.2026: playlists from other services, found
// in Yandex's catalogue; nothing is downloaded from those services.
//
// Each service is read the way its own web page is, with no sign-in: Spotify's embed page (its
// first 100 tracks: the rest needs a Spotify sign-in — paste them or bring Exportify's CSV),
// Apple Music's page (the tracks it shows), YouTube Music's own API, the one its site uses (the
// whole list, page by page). The parsers are pure, so they are tested offline (tests/import.test.ts).

import type { HttpRequest, HttpResponse } from '../api/transport.ts';

export interface SourceTrack {
  title: string;
  artists: string[];
  durationMs?: number;
}

export interface SourceList {
  title: string;
  tracks: SourceTrack[];
  /** Where it came from (shown on the page). */
  from: 'spotify' | 'apple' | 'youtube' | 'text';
  /** The service shows only part of the list without a sign-in (Spotify: 100). */
  partial?: boolean;
}

export type Fetch = <T = any>(req: HttpRequest) => Promise<HttpResponse<T>>;

/** A service that does not answer in this long has not answered: in Russia YouTube is slowed down
 * to a standstill, and the phone waited for it for ever (the user, 26.10.2026: "Find" — and an
 * endless spinner on the iPhone, while the PC read the same link). */
const WAIT_MS = 25_000;

function within<T>(p: Promise<T>, ms = WAIT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ImportError('slow')), ms);
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export class ImportError extends Error {
  reason: 'link' | 'private' | 'empty' | 'network' | 'slow';
  constructor(reason: ImportError['reason']) {
    super(reason);
    this.reason = reason;
  }
}

/** A link (anything that parses as one of the services' playlist links), else the text itself. */
export function sourceOf(input: string): { kind: 'spotify' | 'apple' | 'youtube'; id: string; url: string } | null {
  const text = input.trim();
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/\/playlist\/([A-Za-z0-9]+)/);
    if (m) return { kind: 'spotify', id: m[1], url: text };
  }
  if (host === 'music.apple.com' && /\/playlist\//.test(u.pathname)) return { kind: 'apple', id: u.pathname, url: `https://music.apple.com${u.pathname}` };
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be') {
    const list = u.searchParams.get('list');
    if (list) return { kind: 'youtube', id: list, url: text };
  }
  return null;
}

/** Spotify's embed page: its __NEXT_DATA__ holds the list (at most 100 tracks). */
export function parseSpotify(html: string): SourceList {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  const entity = m ? JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity : null;
  if (!entity?.trackList) throw new ImportError('private');
  const tracks: SourceTrack[] = entity.trackList.map((t: { title: string; subtitle?: string; duration?: number }) => ({
    title: t.title,
    // "Artist A, Artist B" — names with a comma of their own are rare enough
    artists: (t.subtitle ?? '').split(/,\s*/).map((a) => a.trim()).filter(Boolean),
    durationMs: t.duration || undefined,
  }));
  return { title: entity.name ?? entity.title ?? 'Spotify', tracks, from: 'spotify', partial: tracks.length >= 100 };
}

/** Apple Music's playlist page: the serialized page data has the tracks (title, artist, length). */
export function parseApple(html: string): SourceList {
  const m = html.match(/<script type="application\/json" id="serialized-server-data">(.*?)<\/script>/s);
  const page = m ? JSON.parse(m[1])?.data?.[0]?.data : null;
  const sections: { itemKind: string; items?: any[] }[] = page?.sections ?? [];
  const header = sections.find((s) => s.itemKind === 'containerDetailHeaderLockup')?.items?.[0];
  const items = sections.filter((s) => s.itemKind === 'trackLockup').flatMap((s) => s.items ?? []);
  if (!items.length) throw new ImportError('private');
  const tracks = items.map((t) => ({ title: String(t.title), artists: splitArtists(String(t.artistName ?? '')), durationMs: t.duration || undefined }));
  const count = Number(header?.trackCount) || 0;
  return { title: header?.title ?? 'Apple Music', tracks, from: 'apple', partial: count > tracks.length };
}

/** "A & B", "A feat. B", "A, B" → [A, B]. */
function splitArtists(s: string) {
  return s
    .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bи\b)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** One page of YouTube Music's playlist (its browse answer, or a continuation of it). */
export function parseYoutubePage(data: any): { title?: string; tracks: SourceTrack[]; next?: string } {
  const tracks: SourceTrack[] = [];
  let next: string | undefined;
  let title: string | undefined;
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    const item = o.musicResponsiveListItemRenderer;
    if (item) {
      const cols = (item.flexColumns ?? []).map((c: any) => (c.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []).map((r: any) => r.text as string));
      const name = cols[0]?.join('') ?? '';
      // the second column: the artists, joined by " & " / ", " runs (an album or views may follow a "•")
      const by = (cols[1] ?? []).join('').split(' • ')[0];
      const fixed = item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text as string | undefined;
      if (name) tracks.push({ title: name, artists: splitArtists(by), durationMs: fixed ? clock(fixed) : undefined });
      return;
    }
    // the list's own "more" (the page's other sections, such as suggestions, page on their own)
    const token = o.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (token) next ??= token;
    if (!title && o.musicResponsiveHeaderRenderer?.title?.runs) title = o.musicResponsiveHeaderRenderer.title.runs.map((r: any) => r.text).join('');
    if (!title && o.musicDetailHeaderRenderer?.title?.runs) title = o.musicDetailHeaderRenderer.title.runs.map((r: any) => r.text).join('');
    for (const v of Object.values(o)) walk(v);
  };
  walk(data);
  return { title, tracks, next };
}

/** "3:45" or "1:02:03" → ms. */
function clock(s: string) {
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.reduce((a, n) => a * 60 + n, 0) * 1000;
}

/**
 * Pasted text or a file's: Exportify's CSV (a header with "Track Name" and "Artist Name(s)"), or
 * a line per track — "Artist — Title", "Artist - Title", "Title by Artist", or a title alone.
 * A leading number ("1.", "01)") and a trailing length ("3:45") are dropped.
 */
export function parseText(text: string, title = ''): SourceList {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && /track name/i.test(lines[0]) && /artist name/i.test(lines[0])) return parseCsv(lines, title);
  const tracks: SourceTrack[] = [];
  for (const raw of lines) {
    let line = raw.replace(/^\d{1,4}\s*[.)\]:-]?\s+/, '');
    let durationMs: number | undefined;
    const time = line.match(/\s*[([]?(\d{1,2}:\d{2}(?::\d{2})?)[)\]]?$/);
    if (time) {
      durationMs = clock(time[1]);
      line = line.slice(0, time.index).trim();
    }
    const dash = line.split(/\s+[—–-]\s+/);
    const by = line.match(/^(.+?)\s+by\s+(.+)$/i);
    if (dash.length >= 2) tracks.push({ artists: splitArtists(dash[0]), title: dash.slice(1).join(' - '), durationMs });
    else if (by) tracks.push({ title: by[1], artists: splitArtists(by[2]), durationMs });
    else if (line) tracks.push({ title: line, artists: [], durationMs });
  }
  return { title, tracks, from: 'text' };
}

function parseCsv(lines: string[], title: string): SourceList {
  const row = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (quoted) {
        if (c === '"' && l[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') out.push(cur), (cur = '');
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = row(lines[0]).map((h) => h.toLowerCase());
  const at = (name: RegExp) => head.findIndex((h) => name.test(h));
  const [ti, ai, di] = [at(/^track name/), at(/^artist name/), at(/duration/)];
  const tracks = lines.slice(1).map(row).filter((r) => r[ti]).map((r) => ({
    title: r[ti],
    // Exportify joins several artists with commas
    artists: (r[ai] ?? '').split(/,\s*/).filter(Boolean),
    durationMs: di >= 0 ? Number(r[di]) || undefined : undefined,
  }));
  return { title, tracks, from: 'text' };
}

/** Reads a link's playlist, through the app's own requests (no browser limits, no sign-in). */
/** `wait`: how long one answer is waited for (tests make it short). */
export async function fetchSource(input: string, fetch: Fetch, wait = WAIT_MS): Promise<SourceList> {
  const src = sourceOf(input);
  if (!src) throw new ImportError('link');
  const page = async (url: string) => {
    const r = await within(fetch<string>({ url, headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, responseType: 'text' }), wait);
    if (r.status === 404) throw new ImportError('private');
    if (!r.ok) throw new ImportError('network');
    return r.data;
  };
  let list: SourceList;
  if (src.kind === 'spotify') list = parseSpotify(await page(`https://open.spotify.com/embed/playlist/${src.id}`));
  else if (src.kind === 'apple') list = parseApple(await page(src.url));
  else list = await fetchYoutube(src.id, fetch, wait);
  if (!list.tracks.length) throw new ImportError('empty');
  return list;
}

const YTM = 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false';
const YTM_CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20241023.01.00', hl: 'en' };

async function fetchYoutube(id: string, fetch: Fetch, wait: number): Promise<SourceList> {
  const ask = async (body: object) => {
    const r = await within(fetch({ method: 'POST', url: YTM, headers: { 'User-Agent': UA, Origin: 'https://music.youtube.com' }, json: { context: { client: YTM_CLIENT }, ...body } }), wait);
    if (!r.ok) throw new ImportError(r.status === 404 || r.status === 400 ? 'private' : 'network');
    return r.data;
  };
  const first = parseYoutubePage(await ask({ browseId: `VL${id}` }));
  const tracks = [...first.tracks];
  let next = first.next;
  // up to 5000 tracks (50 pages): YouTube's own playlists stop there
  for (let i = 0; next && i < 50; i++) {
    const more = parseYoutubePage(await ask({ continuation: next }));
    if (!more.tracks.length) break;
    tracks.push(...more.tracks);
    next = more.next;
  }
  if (!tracks.length) throw new ImportError('private');
  return { title: first.title ?? 'YouTube', tracks, from: 'youtube' };
}
