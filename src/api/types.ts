export interface Artist {
  id: number | string;
  name: string;
  cover?: { uri?: string };
  ogImage?: string;
  genres?: string[];
  various?: boolean;
}

export interface Album {
  id: number;
  title: string;
  version?: string;
  coverUri?: string;
  ogImage?: string;
  year?: number;
  releaseDate?: string;
  genre?: string;
  type?: string;
  trackCount?: number;
  artists: Artist[];
  volumes?: Track[][];
  likesCount?: number;
}

export interface Track {
  id: string;
  title: string;
  version?: string;
  durationMs?: number;
  artists: Artist[];
  albums: Album[];
  coverUri?: string;
  ogImage?: string;
  available?: boolean;
  contentWarning?: string;
  trackSource?: string;
  lyricsInfo?: { hasAvailableSyncLyrics?: boolean; hasAvailableTextLyrics?: boolean };
  r128?: { i: number; tp: number };
  derivedColors?: { average: string; waveText: string; miniPlayer: string; accent: string };
}

export interface PlaylistTrackItem {
  id: number | string;
  originalIndex?: number;
  track?: Track;
  albumId?: number;
}

export interface Playlist {
  uid: number;
  kind: number;
  title: string;
  description?: string;
  trackCount: number;
  durationMs?: number;
  revision: number;
  visibility?: string;
  cover?: { type?: string; uri?: string; itemsUri?: string[] };
  ogImage?: string;
  owner: { uid: number; login: string; name: string };
  tracks?: PlaylistTrackItem[];
  playlistUuid?: string;
}

export interface GenreTree {
  /** Top-level genre for any genre or sub-genre id. */
  parent: Record<string, string>;
  title: Record<string, string>;
}

/** Where a stretch of listening happened, as Yandex's history groups it. */
export type HistoryContext =
  | { type: 'wave'; seeds: string[]; title?: string }
  | { type: 'playlist'; uid: number; kind: number; title?: string }
  | { type: 'album'; id: number; title?: string }
  | { type: 'artist'; id: number; title?: string }
  | { type: 'other' };

export interface HistoryGroup {
  context: HistoryContext;
  tracks: Track[];
}

export interface HistoryDay {
  /** YYYY-MM-DD */
  date: string;
  groups: HistoryGroup[];
}

export interface Account {
  uid: number;
  login: string;
  displayName: string;
  hasPlus: boolean;
}

export interface SearchResult {
  best?: { type: string; result: Track | Album | Artist | Playlist };
  tracks?: { results: Track[]; total: number };
  albums?: { results: Album[]; total: number };
  artists?: { results: Artist[]; total: number };
  playlists?: { results: Playlist[]; total: number };
}

export interface ArtistInfo {
  artist: Artist;
  albums: Album[];
  alsoAlbums?: Album[];
  popularTracks: Track[];
  similarArtists: Artist[];
}

export interface StreamInfo {
  url: string;
  codec: string;
  bitrate: number;
}

export interface WaveContext {
  type: string;
  tag: string;
  name: string;
}

/** A single item delivered by a wave session. */
export interface WaveItem {
  track: Track;
  liked: boolean;
}

export interface WaveBatch {
  sessionId: string;
  batchId: string;
  items: WaveItem[];
}

export type WaveEventType = 'radioStarted' | 'trackStarted' | 'trackFinished' | 'skip' | 'like' | 'dislike';
