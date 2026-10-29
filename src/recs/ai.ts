// AI music, marked (from other clients — docs/other-clients.md): slopless.art (open, no key) knows
// which artists of Yandex Music put out AI-made tracks, and which ones. Asked per artist (one answer
// lists all of an artist's AI tracks), not per track, and kept a week; only Yandex's artist ids go
// there. Its answer missing (it is down, no network): no mark, nothing else changes.

import { create } from 'zustand';
import { storage, transport } from '../api/client.ts';
import type { Track } from '../api/types.ts';
import { aiTrack, fromAnswer, type AiAnswer, type AiArtist } from './aiRule.ts';

export type { AiArtist };

const KEY = 'ai.v1';
const API = 'https://slopless.art/api/artist/';
const WEEK = 7 * 24 * 3600_000;
const KEEP = 3000;

let kept: Record<string, AiArtist> | null = null;
/** Every AI track known, for the wave's filter (it has only an id to go by). */
let known: Set<string> | null = null;
const asking = new Map<string, Promise<AiArtist | null>>();

/** Settings: the mark shown (and asked for at all); AI tracks skipped in My Wave and radios. */
export const useAi = create<{ mark: boolean; skip: boolean; v: number }>(() => {
  try {
    const p = JSON.parse(storage.getItem('ai.prefs') || '{}');
    return { mark: p.mark !== false, skip: Boolean(p.skip), v: 0 };
  } catch {
    return { mark: true, skip: false, v: 0 };
  }
});

export function setAiPrefs(next: { mark?: boolean; skip?: boolean }) {
  useAi.setState(next);
  const { mark, skip } = useAi.getState();
  storage.setItem('ai.prefs', JSON.stringify({ mark, skip }));
}

function cache() {
  if (!kept) {
    try {
      kept = JSON.parse(storage.getItem(KEY) || '{}') as Record<string, AiArtist>;
    } catch {
      kept = {};
    }
    known = new Set(Object.values(kept).flatMap((a) => a.tracks));
  }
  return kept;
}

/** What slopless says of an artist (a fresh answer kept), or null when it could not say. */
export function aiArtist(id: string | number): AiArtist | undefined {
  return cache()[String(id)];
}

/** A track is AI-made, by what is known of its artists (aiRule.ts). */
export const isAi = (t: Track) => aiTrack(t, aiArtist);

/** For the wave's filter: a track known to be AI by its id alone. */
export function isKnownAi(id: string) {
  cache();
  return known!.has(String(id));
}

async function ask(id: string): Promise<AiArtist | null> {
  try {
    const r = await transport.request<AiAnswer>({ url: API + id, headers: { Accept: 'application/json' } });
    // Down or refusing: asked again another time. An artist it does not know gets its web page, not
    // an answer — kept as "nothing AI".
    if (!r.ok) return null;
    const answer = r.data && typeof r.data === 'object' ? r.data : {};
    const info = fromAnswer(answer, Date.now());
    const all = cache();
    delete all[id];
    all[id] = info;
    const ids = Object.keys(all);
    for (const old of ids.slice(0, Math.max(0, ids.length - KEEP))) delete all[old];
    for (const t of info.tracks) known!.add(t);
    storage.setItem(KEY, JSON.stringify(all));
    useAi.setState((s) => ({ v: s.v + 1 }));
    return info;
  } catch {
    return null;
  }
}

/** Asks about the artists of these tracks not known this week (a few at a time). Resolves when done. */
export function lookAi(tracks: (Track | undefined)[]): Promise<void> {
  // A track of one's own (an upload) has no artist slopless could know.
  const mine = (t: Track) => t.trackSource === 'UGC' || Boolean(t.share);
  return lookAiArtists(tracks.flatMap((t) => (t && !mine(t) ? (t.artists ?? []).map((a) => a.id) : [])));
}

/** Asks about these artists, those not known this week. */
export async function lookAiArtists(artists: (string | number | undefined)[]): Promise<void> {
  if (!useAi.getState().mark && !useAi.getState().skip) return;
  const now = Date.now();
  const ids = new Set<string>();
  for (const a of artists) if (a && !(aiArtist(a) && now - aiArtist(a)!.at < WEEK)) ids.add(String(a));
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      if (!asking.has(id)) asking.set(id, ask(id).finally(() => asking.delete(id)));
      await asking.get(id);
    }
  };
  await Promise.all([worker(), worker()]);
}
