// What makes a track AI-made, from slopless.art's answers about its artists (ai.ts asks and keeps
// them). Apart, so the offline tests can try it.

import type { Track } from '../api/types.ts';

/** An artist mostly of AI tracks: an AI artist (its tracks not checked one by one count as AI too). */
const MOSTLY = 0.5;

export interface AiArtist {
  /** AI tracks found, of all the artist's. */
  ai: number;
  total: number;
  /** The AI tracks' ids. */
  tracks: string[];
  at: number;
}

/** GET slopless.art/api/artist/<id>: the parts used. */
export interface AiAnswer {
  aiTracks?: number;
  totalTracks?: number;
  aiTrackList?: { id: number | string }[];
  yandexAiTrackList?: { id: number | string }[];
}

/** An answer, as kept: its own list and the one checked on Yandex's side, together. */
export function fromAnswer(a: AiAnswer, at: number): AiArtist {
  const ids = new Set([...(a.aiTrackList ?? []), ...(a.yandexAiTrackList ?? [])].map((t) => String(t.id)));
  return { ai: Math.max(a.aiTracks ?? 0, ids.size), total: a.totalTracks ?? 0, tracks: [...ids], at };
}

/** A track is AI-made: slopless found it so, or one of its artists is mostly AI. */
export function aiTrack(t: Track, artists: (id: string) => AiArtist | undefined): boolean {
  const id = String(t.id);
  for (const a of t.artists ?? []) {
    const info = artists(String(a.id));
    if (!info) continue;
    if (info.tracks.includes(id)) return true;
    if (info.total > 0 && info.ai / info.total >= MOSTLY) return true;
  }
  return false;
}
