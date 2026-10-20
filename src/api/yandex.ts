import type { HttpRequest, Transport } from './transport.ts';
import type {
  Account,
  Album,
  Artist,
  ArtistInfo,
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

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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

export class YandexMusic {
  private me?: Account;
  private transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  private async call<T = any>(path: string, req: Omit<HttpRequest, 'url'> = {}): Promise<T> {
    const url = path.startsWith('http') ? path : API + path;
    const resp = await this.transport.request({ ...req, url });
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

  album(id: number | string) {
    return this.call<Album>(`/albums/${id}/with-tracks`);
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

  playlist(uid: number | string, kind: number | string) {
    return this.call<Playlist>(`/users/${uid}/playlists/${kind}`, { query: { 'rich-tracks': true } });
  }

  async createPlaylist(title: string): Promise<Playlist> {
    return this.call(`/users/${await this.uid()}/playlists/create`, { method: 'POST', form: { title, visibility: 'private' } });
  }

  async renamePlaylist(kind: number, title: string): Promise<Playlist> {
    return this.call(`/users/${await this.uid()}/playlists/${kind}/name`, { method: 'POST', form: { value: title } });
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

  // ---------------------------------------------------------------- playback

  async stream(trackId: string): Promise<StreamInfo> {
    const ts = Math.floor(Date.now() / 1000);
    const quality = 'lossless';
    const codecs = 'flac,aac,he-aac,mp3';
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
    return { sessionId: r.radioSessionId, batchId: r.batchId, items: r.sequence.map((x: any) => ({ track: x.track, liked: x.liked })) };
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
  async upload(file: { name: string; data: ArrayBuffer }, pl: Playlist) {
    const uid = await this.uid();
    const target = await this.call<any>('/loader/upload-url', {
      method: 'POST',
      query: { uid, 'playlist-id': `${uid}:${pl.kind}`, path: file.name },
    });
    if (target.result === 'TOO_MANY_FILES') throw new ApiError(429, tr().playlist.tooManyFiles);
    const resp = await this.transport.request({
      method: 'POST',
      url: target['post-target'],
      multipart: { field: 'file', filename: file.name, contentType: 'audio/mpeg', data: file.data },
    });
    if (!resp.ok) throw new ApiError(resp.status, tr().playlist.uploadFailed(resp.status));
    return target['ugc-track-id'] as string | undefined;
  }
}
