import type { HttpRequest, Transport } from './transport.ts';
import type {
  Account,
  Album,
  Artist,
  ArtistInfo,
  GenreTree,
  HistoryContext,
  HistoryDay,
  HistoryGroup,
  Playlist,
  SearchResult,
  StreamInfo,
  Track,
  WaveBatch,
  WaveContext,
  WaveEventType,
} from './types.ts';
import { tr } from '../i18n.ts';

const API = 'https://api.music.yandex.net';
// Keys the official desktop client uses to sign stream and lyrics requests.
const FILE_INFO_KEY = 'kzqU4XhfCaY6B6JTHODeq5';
const LYRICS_KEY = 'p93jhgh689SBReK6ghtw62';
const DESKTOP_CLIENT = 'YandexMusicDesktopAppWindows/5.13.2';

/** Sound quality as in the official app: superb (lossless when available), balanced, efficient. */
export type StreamQuality = 'lossless' | 'nq' | 'lq';
const STREAM_CODECS: Record<StreamQuality, string> = {
  lossless: 'flac,aac,he-aac,mp3',
  nq: 'aac,mp3,he-aac',
  lq: 'he-aac,aac,mp3',
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A request that never reached Yandex (no network, or it dropped): the one error that means
 * "offline". Anything else (a track that would not start, a refusal) is not. */
export class NetworkError extends Error {}

export function coverUrl(uri: string | undefined, size = 400): string | undefined {
  if (!uri) return undefined;
  return `https://${uri.replace('%%', `${size}x${size}`)}`;
}

export function trackCover(t: Track | undefined, size = 400) {
  return coverUrl(t?.coverUri || t?.albums?.[0]?.coverUri || t?.ogImage, size);
}

export function playlistCover(p: Playlist, size = 400) {
  return coverUrl(p.cover?.uri || p.cover?.itemsUri?.[0] || p.ogImage, size);
}

export function artistCover(a: Artist, size = 400) {
  return coverUrl(a.cover?.uri || a.ogImage, size);
}

/** "id:albumId" — the form most endpoints expect. */
export function trackKey(t: Track) {
  const album = t.albums?.[0]?.id;
  return album ? `${t.id}:${album}` : String(t.id);
}

/** The catalog's track an upload stands for, where Yandex has found it (the user, 24.10.2026: the
 * artist, "Similar", the radio and the lyrics go by it; the file still plays, never replaced). */
export function catalogTrack(t: Track): Track | null {
  return t.trackSource === 'UGC' && t.matchedTrack?.id ? t.matchedTrack : null;
}

export function artistNames(t: { artists?: Artist[] }) {
  return (t.artists || []).map((a) => a.name).join(', ');
}

async function hmacBase64(key: string, message: string) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Search returns numeric track ids while /tracks returns strings — make them all strings. */
function normalizeIds(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) normalizeIds(v);
  } else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('id' in o && Array.isArray(o.albums) && Array.isArray(o.artists)) o.id = String(o.id);
    for (const v of Object.values(o)) if (v && typeof v === 'object') normalizeIds(v);
  }
}

const chunk = <T,>(arr: T[], size: number) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function historyContext(ctx: any): HistoryContext {
  const id = ctx?.data?.itemId || {};
  const full = ctx?.data?.fullModel || {};
  switch (ctx?.type) {
    case 'wave':
      return { type: 'wave', seeds: id.seeds || [], title: full.wave?.title };
    case 'playlist':
      return { type: 'playlist', uid: id.uid, kind: id.kind, title: full.playlist?.title };
    case 'album':
      return { type: 'album', id: id.id ?? id.albumId, title: full.album?.title };
    case 'artist':
      return { type: 'artist', id: id.id ?? id.artistId, title: full.artist?.name };
    default:
      return { type: 'other' };
  }
}

/**
 * The seconds of a play to report. A track that played to its end (by itself or into the next
 * one's crossfade) counts its last seconds too: they sound while the next one fades in. Yandex
 * puts a play into the history only at ~95 % of the track (checked on the account: 90 % no, 95 %
 * yes), and with a 5 s crossfade a short track never got there (the user). `position`: where the
 * track was when left.
 */
export function heardSeconds(listened: number, ended: boolean, duration: number, position: number) {
  return ended ? listened + Math.max(0, duration - position) : listened;
}

const acceptedSeeds = (r: any): string[] => (r.acceptedSeeds || []).map((s: any) => `${s.type}:${s.tag}`);

export class YandexMusic {
  private me?: Account;
  private transport: Transport;
  /** Sent as Accept-Language: Yandex localizes station, context and genre names by it. */
  language = 'ru';
  private genreCache = new Map<string, Promise<GenreTree>>();

  constructor(transport: Transport) {
    this.transport = transport;
  }

  private async call<T = any>(path: string, req: Omit<HttpRequest, 'url'> = {}): Promise<T> {
    const external = path.startsWith('http');
    const url = external ? path : API + path;
    const headers = external ? req.headers : { 'Accept-Language': this.language, ...req.headers };
    let resp;
    try {
      resp = await this.transport.request({ ...req, url, headers });
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : String(e));
    }
    if (!resp.ok) {
      const err = resp.data?.error;
      const msg = (typeof err === 'object' ? err?.message || err?.name : err) || `HTTP ${resp.status}`;
      throw new ApiError(resp.status, String(msg));
    }
    const data = resp.data;
    normalizeIds(data);
    return (data && typeof data === 'object' && 'result' in data ? data.result : data) as T;
  }

  // ------------------------------------------------------------------ account

  async account(force = false): Promise<Account> {
    if (this.me && !force) return this.me;
    const r = await this.call('/account/status');
    this.me = {
      uid: r.account.uid,
      login: r.account.login,
      displayName: r.account.displayName || r.account.fullName || r.account.login,
      hasPlus: Boolean(r.plus?.hasPlus),
    };
    return this.me;
  }

  private async uid() {
    return (await this.account()).uid;
  }

  // ------------------------------------------------------------------- browse

  search(text: string, type: 'all' | 'track' | 'album' | 'artist' | 'playlist' = 'all', page = 0) {
    return this.call<SearchResult>('/search', { query: { text, type, page, nocorrect: false } });
  }

  async tracks(keys: string[]): Promise<Track[]> {
    const out: Track[] = [];
    for (const part of chunk(keys, 200)) {
      out.push(...(await this.call<Track[]>('/tracks', { method: 'POST', form: { 'track-ids': part.join(',') } })));
    }
    return out;
  }

  /**
   * Tells Yandex a track was listened to, like the official clients do. This is what
   * puts plays into the account's history and lets Yandex's own recommendations learn.
   * Sent as POST /plays, as Yandex's own app does: since October 2026 the old /play-audio
   * form still answers "ok" but nothing reaches the history (the user: none after the 21st).
   * The wave's plays go here too: its session feedback alone is not a play in the history.
   */
  async reportPlay(r: {
    track: Track;
    playId: string;
    startedAt: Date;
    playedSeconds: number;
    endSeconds: number;
    playlist?: string;
    album?: number | string;
    wave?: { sessionId: string; batchId: string; seeds: string[] };
  }) {
    const now = new Date().toISOString();
    const album = r.album ?? r.track.albums?.[0]?.id;
    const context = r.wave
      ? { context: 'radio', contextItem: r.wave.seeds.join(), radioSessionId: r.wave.sessionId, batchId: r.wave.batchId }
      : r.playlist
        ? { context: 'playlist', contextItem: r.playlist, playlistId: r.playlist }
        : r.album !== undefined
          ? { context: 'album', contextItem: String(r.album) }
          : { context: 'other' };
    const play = {
      trackId: String(r.track.id),
      albumId: album !== undefined ? String(album) : undefined,
      playId: r.playId,
      from: r.wave ? 'desktop_win-home-wave' : 'desktop_win-wave-player',
      ...context,
      timestamp: now,
      startTimestamp: r.startedAt.toISOString(),
      trackLengthSeconds: Math.round((r.track.durationMs || 0) / 1000),
      totalPlayedSeconds: Math.round(r.playedSeconds),
      endPositionSeconds: Math.round(r.endSeconds),
      fromCache: false,
    };
    await this.call('/plays', { method: 'POST', query: { clientNow: now }, json: { plays: [play] } });
  }

  /** Which tracks the account played on which day (about ten days, every device): ids only,
   * for the wave's repeat filter, without fetching the tracks themselves. */
  async musicHistoryPlays(): Promise<{ id: string; at: number }[]> {
    const r = await this.call<any>('/music-history', { query: { fullModelsCount: 0 } });
    return (r.historyTabs || []).flatMap((tab: any) => {
      const at = Date.parse(tab.date);
      return (tab.items || []).flatMap((item: any) =>
        (item.tracks || []).map((x: any) => x.data?.itemId?.trackId).filter(Boolean).map((id: any) => ({ id: String(id), at })),
      );
    });
  }

  /**
   * Listening history across all the user's devices, by day and by where it was played
   * (about the last ten days). Yandex sends full track data only for the first items,
   * so the rest is fetched in batches.
   */
  async musicHistory(): Promise<HistoryDay[]> {
    const r = await this.call<any>('/music-history', { query: { fullModelsCount: 50 } });
    const known = new Map<string, Track>();
    const keys: string[] = [];
    const days = (r.historyTabs || []).map((tab: any) => ({
      date: tab.date,
      groups: (tab.items || []).map((item: any) => {
        const ids = (item.tracks || []).map((x: any) => {
          const id = x.data?.itemId;
          const key = id?.albumId ? `${id.trackId}:${id.albumId}` : String(id?.trackId);
          if (x.data?.fullModel) known.set(key, x.data.fullModel);
          else keys.push(key);
          return key;
        });
        return { context: historyContext(item.context), ids };
      }),
    }));
    for (const t of await this.tracks([...new Set(keys)].filter((k) => !known.has(k)))) known.set(trackKey(t), t);
    // Tracks come back keyed by "id:albumId" for whatever album Yandex picks; fall back to the id alone.
    const byId = new Map([...known.values()].map((t) => [String(t.id), t]));
    return days.map((d: any) => ({
      date: d.date,
      groups: d.groups
        .map((g: any) => ({ context: g.context, tracks: g.ids.map((k: string) => known.get(k) ?? byId.get(k.split(':')[0])).filter(Boolean) }))
        .filter((g: HistoryGroup) => g.tracks.length),
    }));
  }

  album(id: number | string) {
    return this.call<Album>(`/albums/${id}/with-tracks`);
  }

  /** Everything the official app's "Track details" shows: album with year, genre and labels, chart place. */
  async trackFullInfo(t: Track): Promise<Track> {
    const album = t.albums?.[0]?.id;
    const r = await this.call<{ track: Track }>(`/tracks/${album ? `${t.id}:${album}` : t.id}/full-info`);
    return r.track;
  }

  /** Renames your own upload (title and artist), as "Edit" in the official app does. */
  async changeUpload(id: string | number, change: { title: string; artist: string }) {
    await this.call(`/ugc/tracks/${id}/change`, { method: 'POST', json: change });
  }

  async albums(ids: (number | string)[]): Promise<Album[]> {
    if (!ids.length) return [];
    return this.call<Album[]>('/albums', { method: 'POST', form: { 'album-ids': ids.join(',') } });
  }

  artist(id: number | string) {
    return this.call<ArtistInfo>(`/artists/${id}/brief-info`);
  }

  async artistTracks(id: number | string, page = 0, pageSize = 50) {
    const r = await this.call<{ tracks: Track[] }>(`/artists/${id}/tracks`, { query: { page, 'page-size': pageSize } });
    return r.tracks;
  }

  async similarTracks(id: string) {
    const r = await this.call<{ similarTracks: Track[] }>(`/tracks/${id}/similar`);
    return r.similarTracks;
  }

  async chart(): Promise<Track[]> {
    const r = await this.call<any>('/landing3/chart');
    return (r.chart?.tracks || []).map((x: any) => x.track).filter(Boolean);
  }

  async newReleases(limit = 24): Promise<Album[]> {
    const r = await this.call<{ newReleases: number[] }>('/landing3/new-releases');
    return this.albums((r.newReleases || []).slice(0, limit));
  }

  // ---------------------------------------------------------------- library

  async likedTrackKeys(): Promise<string[]> {
    const r = await this.call<any>(`/users/${await this.uid()}/likes/tracks`);
    return r.library.tracks.map((t: any) => (t.albumId ? `${t.id}:${t.albumId}` : String(t.id)));
  }

  /** The liked tracks' keys with the date of each like (ms), newest first. */
  async likedTrackDates(): Promise<{ key: string; at: number }[]> {
    const r = await this.call<any>(`/users/${await this.uid()}/likes/tracks`);
    return r.library.tracks.map((t: any) => ({ key: t.albumId ? `${t.id}:${t.albumId}` : String(t.id), at: Date.parse(t.timestamp) || 0 }));
  }

  async dislikedTrackIds(): Promise<string[]> {
    const r = await this.call<any>(`/users/${await this.uid()}/dislikes/tracks`);
    return r.library.tracks.map((t: any) => String(t.id));
  }

  async setLiked(keys: string[], liked: boolean) {
    const action = liked ? 'add-multiple' : 'remove';
    await this.call(`/users/${await this.uid()}/likes/tracks/${action}`, { method: 'POST', form: { 'track-ids': keys.join(',') } });
  }

  async setDisliked(keys: string[], disliked: boolean) {
    const action = disliked ? 'add-multiple' : 'remove';
    await this.call(`/users/${await this.uid()}/dislikes/tracks/${action}`, { method: 'POST', form: { 'track-ids': keys.join(',') } });
  }

  async likedAlbums(): Promise<Album[]> {
    const r = await this.call<any[]>(`/users/${await this.uid()}/likes/albums`, { query: { rich: true } });
    return r.map((x) => x.album).filter(Boolean);
  }

  async likedArtists(): Promise<Artist[]> {
    const r = await this.call<any[]>(`/users/${await this.uid()}/likes/artists`, { query: { 'with-timestamps': false } });
    return r.map((x) => x.artist || x).filter((a) => a?.name);
  }

  async playlists(): Promise<Playlist[]> {
    return this.call<Playlist[]>(`/users/${await this.uid()}/playlists/list`);
  }

  /** Someone else's own playlists (their open ones). */
  async userPlaylists(uid: number | string): Promise<Playlist[]> {
    return this.call<Playlist[]>(`/users/${uid}/playlists/list`);
  }

  /** Other people's playlists the user liked; /playlists/list returns only their own. */
  async likedPlaylists(): Promise<Playlist[]> {
    const r = await this.call<any[]>(`/users/${await this.uid()}/likes/playlists`);
    return r.map((x) => x.playlist || x).filter((p) => p?.kind !== undefined);
  }

  async setPlaylistLiked(pl: { uid: number; kind: number }, liked: boolean) {
    // "remove" ignores the owner-uid/kind form that "add" accepts; playlist-ids works for both.
    const action = liked ? 'add-multiple' : 'remove';
    await this.call(`/users/${await this.uid()}/likes/playlists/${action}`, { method: 'POST', form: { 'playlist-ids': `${pl.uid}:${pl.kind}` } });
  }

  /** `rich`: with every track in it; without, ids only (a big list's tracks then come by `tracks`). */
  playlist(uid: number | string, kind: number | string, rich = true) {
    return this.call<Playlist>(`/users/${uid}/playlists/${kind}`, { query: { 'rich-tracks': rich } });
  }

  async createPlaylist(title: string): Promise<Playlist> {
    return this.call(`/users/${await this.uid()}/playlists/create`, { method: 'POST', form: { title, visibility: 'private' } });
  }

  async renamePlaylist(kind: number, title: string): Promise<Playlist> {
    return this.call(`/users/${await this.uid()}/playlists/${kind}/name`, { method: 'POST', form: { value: title } });
  }

  /** The description shown under a playlist (found in the official app: changePlaylistDescription). */
  async setPlaylistDescription(kind: number, value: string): Promise<Playlist> {
    return this.call(`/users/${await this.uid()}/playlists/${kind}/description`, { method: 'POST', query: { value } });
  }

  async deletePlaylist(kind: number) {
    await this.call(`/users/${await this.uid()}/playlists/${kind}/delete`, { method: 'POST' });
  }

  async addToPlaylist(pl: Playlist, tracks: Track[], at = 0): Promise<Playlist> {
    const diff = [{ op: 'insert', at, tracks: tracks.map((t) => ({ id: t.id, albumId: t.albums?.[0]?.id })) }];
    return this.call(`/users/${pl.uid}/playlists/${pl.kind}/change-relative`, {
      method: 'POST',
      form: { diff: JSON.stringify(diff), revision: pl.revision },
    });
  }

  async removeFromPlaylist(pl: Playlist, index: number): Promise<Playlist> {
    const diff = [{ op: 'delete', from: index, to: index + 1 }];
    return this.call(`/users/${pl.uid}/playlists/${pl.kind}/change-relative`, {
      method: 'POST',
      form: { diff: JSON.stringify(diff), revision: pl.revision },
    });
  }

  /** Moves the track at `from` to `to` (the official app's drag and drop; found in its code). The
   * track is named too, so a list changed meanwhile is refused rather than moved wrong. Liked is
   * not a list Yandex lets one reorder: it closes the connection. */
  async moveInPlaylist(pl: Playlist, from: number, to: number): Promise<Playlist> {
    const item = pl.tracks?.[from];
    if (!item) throw new Error('no track at ' + from);
    const albumId = item.albumId ?? item.track?.albums?.[0]?.id;
    const diff = [{ op: 'move', from, to, tracks: [{ id: item.id, ...(albumId !== undefined && { albumId }) }] }];
    return this.call(`/users/${pl.uid}/playlists/${pl.kind}/change-relative`, {
      method: 'POST',
      form: { diff: JSON.stringify(diff), revision: pl.revision },
    });
  }

  // ---------------------------------------------------------------- playback

  /** Stream URL in the asked quality; Yandex may give less (it returns what it actually serves). */
  async stream(trackId: string, quality: StreamQuality = 'lossless'): Promise<StreamInfo> {
    const ts = Math.floor(Date.now() / 1000);
    const codecs = STREAM_CODECS[quality];
    const transports = 'raw';
    const sign = (await hmacBase64(FILE_INFO_KEY, `${ts}${trackId}${quality}${codecs.replace(/,/g, '')}${transports}`)).replace(/=+$/, '');
    const r = await this.call<any>('/get-file-info', {
      query: { ts, trackId, quality, codecs, transports, sign },
      headers: { 'X-Yandex-Music-Client': DESKTOP_CLIENT },
    });
    const info = r.downloadInfo;
    return { url: info.urls?.[0] || info.url, codec: info.codec, bitrate: info.bitrate };
  }

  /** LRC (synced) lyrics if available, otherwise plain text, otherwise null. */
  async lyrics(trackId: string): Promise<{ synced: boolean; text: string } | null> {
    for (const format of ['LRC', 'TEXT'] as const) {
      const timeStamp = Math.floor(Date.now() / 1000);
      const sign = await hmacBase64(LYRICS_KEY, `${trackId}${timeStamp}`);
      try {
        const r = await this.call<{ downloadUrl: string }>(`/tracks/${trackId}/lyrics`, {
          query: { format, timeStamp, sign },
        });
        const text = await this.transport.request<string>({ url: r.downloadUrl, responseType: 'text' });
        if (text.ok && text.data.trim()) return { synced: format === 'LRC', text: text.data };
      } catch (e) {
        if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 400)) throw e;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------- wave

  /** Genre titles in the current language and each genre's top-level parent. */
  genreTree(): Promise<GenreTree> {
    let cached = this.genreCache.get(this.language);
    if (!cached) {
      cached = this.call<any[]>('/genres').then((list) => {
        const tree: GenreTree = { parent: {}, title: {} };
        const walk = (gs: any[], top?: string) => {
          for (const g of gs || []) {
            if (!g.id) continue;
            if (g.title) tree.title[g.id] = g.title;
            tree.parent[g.id] = top ?? g.id;
            walk(g.subGenres, top ?? g.id);
          }
        };
        walk(list);
        return tree;
      });
      cached.catch(() => this.genreCache.delete(this.language));
      this.genreCache.set(this.language, cached);
    }
    return cached;
  }

  /** Genre id → title in the current language (artist pages list genres by id). */
  async genreTitles(): Promise<Record<string, string>> {
    return (await this.genreTree()).title;
  }

  /** The artist's own releases, newest first. */
  async artistAlbums(id: number | string, pageSize = 6): Promise<Album[]> {
    const r = await this.call<any>(`/artists/${id}/direct-albums`, { query: { page: 0, 'page-size': pageSize, 'sort-by': 'year' } });
    return r.albums || [];
  }

  async waveContexts(): Promise<WaveContext[]> {
    const r = await this.call<any>('/rotor/wave/settings');
    const block = (r.blocks || []).find((b: any) => b.type === 'contexts');
    return (block?.items || []).map((it: any) => ({ type: it.id.type, tag: it.id.tag, name: it.name }));
  }

  async waveStart(seeds: string[]): Promise<WaveBatch> {
    const r = await this.call<any>('/rotor/session/new', {
      method: 'POST',
      json: { seeds, includeTracksInResponse: true },
    });
    return { sessionId: r.radioSessionId, batchId: r.batchId, items: r.sequence.map((x: any) => ({ track: x.track, liked: x.liked })), accepted: acceptedSeeds(r) };
  }

  /** `queue` is everything the session has handed out so far (track keys), so the server continues past it. */
  async waveMore(sessionId: string, queue: string[]): Promise<WaveBatch> {
    const r = await this.call<any>(`/rotor/session/${sessionId}/tracks`, { method: 'POST', json: { queue } });
    return { sessionId: r.radioSessionId || sessionId, batchId: r.batchId, items: r.sequence.map((x: any) => ({ track: x.track, liked: x.liked })) };
  }

  async waveFeedback(sessionId: string, batchId: string, type: WaveEventType, track?: Track, playedSeconds?: number) {
    const event: Record<string, unknown> = { type, timestamp: new Date().toISOString() };
    if (type === 'radioStarted') event.from = 'desktop_win-home-wave';
    if (track) event.trackId = trackKey(track);
    if (playedSeconds !== undefined) event.totalPlayedSeconds = Math.round(playedSeconds);
    await this.call(`/rotor/session/${sessionId}/feedback`, { method: 'POST', json: { event, batchId } });
  }

  // ------------------------------------------------------------------ upload

  /** Uploads a local audio file into one of the user's playlists (processed by Yandex asynchronously). */
  async upload(file: { name: string; data: ArrayBuffer }, pl: Playlist, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
    const uid = await this.uid();
    // The upload server not answering in time (HTTP 504 — the user, through a VPN, 27.10.2026) or
    // not reached: the file may have gone in all the same, so the playlist is looked at for its
    // track for half a minute before it goes up again, through another server; three tries.
    for (let i = 1; ; i++) {
      const target = await this.call<any>('/loader/upload-url', {
        method: 'POST',
        query: { uid, 'playlist-id': `${uid}:${pl.kind}`, path: file.name },
      });
      if (target.result === 'TOO_MANY_FILES') throw new ApiError(429, tr().playlist.tooManyFiles);
      const id = target['ugc-track-id'] as string | undefined;
      let failed: Error;
      try {
        const resp = await this.transport.request({
          method: 'POST',
          url: target['post-target'],
          multipart: { field: 'file', filename: file.name, contentType: 'audio/mpeg', data: file.data },
        });
        if (resp.ok) return id;
        failed = new ApiError(resp.status, tr().playlist.uploadFailed(resp.status));
        if (resp.status < 500) throw failed;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        failed = new NetworkError(e instanceof Error ? e.message : String(e));
      }
      if (id) {
        for (let w = 0; w < 6; w++) {
          await wait(5000);
          const now = await this.playlist(pl.uid, pl.kind).catch(() => null);
          if (now?.tracks?.some((x) => String(x.id) === id || String(x.track?.id) === id)) return id;
        }
      }
      if (i >= 3) throw failed;
    }
  }
}
