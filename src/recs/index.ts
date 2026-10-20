// Builds the "For you" shelf: taste mixes, "on repeat" and "because you listened to"
// (daily), weekly discoveries and forgotten favourites (Mondays), the release radar
// (Fridays), plus Yandex's own personal playlists.
// Results are cached per account so the shelf opens instantly and stays stable
// for the period it belongs to, like Spotify's.

import { create } from 'zustand';
import { api, storage } from '../api/client.ts';
import type { GenreTree, Playlist, Track } from '../api/types.ts';
import { trackCover } from '../api/yandex.ts';
import { history, recentPlays } from '../player/player.ts';
import { trimTrack } from '../player/recent.ts';
import { useApp } from '../store.ts';
import { discoverSeeds, rankDiscoveries } from './discover.ts';
import { assembleMix, mixSeeds, planMixes } from './mixes.ts';
import { buildProfile, type Profile, type TasteInput } from './profile.ts';
import { becauseYouListened, forgottenFavourites, onRepeat, recentArtists } from './personal.ts';
import { radarArtists, radarTracks, recentReleases } from './radar.ts';
import { DAY, dayKey, mapLimit, seededRandom, weekKey } from './util.ts';

export type MixKind = 'mix' | 'discover' | 'radar' | 'repeat' | 'rewind' | 'because';

export interface Mix {
  id: string;
  kind: MixKind;
  /** For taste mixes: the genre id the mix is built around. */
  genre?: string;
  /** Leading artists, for the subtitle. */
  artists: string[];
  /** "Because you listened to": the artist the mix starts from. */
  seedArtist?: string;
  covers: string[];
  tracks: Track[];
  builtAt: number;
}

interface RecsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  mixes: Mix[];
  personal: Playlist[];
  error: string | null;
}

export const useRecs = create<RecsState>(() => ({ status: 'idle', mixes: [], personal: [], error: null }));

const CACHE_KEY = 'recs.v1';
const CONCURRENCY = 4;

interface Cache {
  uid: string;
  day: string;
  mixes: Mix[];
  discoverWeek?: string;
  discover?: Mix;
  radarWeek?: string;
  radar?: Mix;
  /** Daily: on repeat and because-you-listened-to. */
  personal?: Mix[];
  rewindWeek?: string;
  rewind?: Mix;
}

function readCache(uid: string): Cache | null {
  try {
    const c = JSON.parse(storage.getItem(CACHE_KEY) || 'null') as Cache | null;
    return c?.uid === uid ? c : null;
  } catch {
    return null;
  }
}

const covers = (tracks: Track[]) => [...new Set(tracks.map((t) => trackCover(t, 200)).filter(Boolean) as string[])].slice(0, 4);

const makeMix = (id: string, kind: MixKind, tracks: Track[], artists: string[], genre?: string): Mix => ({
  id,
  kind,
  genre,
  artists: artists.slice(0, 3),
  covers: covers(tracks),
  tracks: tracks.map(trimTrack),
  builtAt: Date.now(),
});

/** Everything the profile and the filters need, fetched once per build. */
async function gather() {
  const app = useApp.getState();
  const [liked, server, tree] = await Promise.all([
    api.tracks(app.likedKeys).catch(() => [] as Track[]),
    api.musicHistory().catch(() => []),
    api.genreTree().catch((): GenreTree => ({ parent: {}, title: {} })),
  ]);

  // Plays from Yandex's history (other devices) and this app's own history.
  const heard = new Map<string, { track: Track; plays: number; skips: number; last: number }>();
  for (const day of server) {
    const at = Date.parse(day.date);
    for (const g of day.groups)
      for (const t of g.tracks) {
        const cur = heard.get(String(t.id));
        if (cur) {
          cur.plays++;
          cur.last = Math.max(cur.last, at);
        } else heard.set(String(t.id), { track: t, plays: 1, skips: 0, last: at });
      }
  }
  for (const { track } of recentPlays.list()) {
    const e = history.get(String(track.id));
    if (!e || heard.has(String(track.id))) continue;
    heard.set(String(track.id), { track, plays: e.plays, skips: e.skips, last: e.last });
  }

  const serverLast = new Map([...heard.values()].map((h) => [String(h.track.id), h.last]));
  const now = Date.now();
  const daysSinceHeard = (id: string) => {
    const local = history.daysSince(id);
    const remote = serverLast.has(id) ? (now - serverLast.get(id)!) / DAY : Infinity;
    return Math.min(local, remote);
  };

  const input: TasteInput = { liked, heard: [...heard.values()], disliked: app.disliked, now };
  return {
    tree,
    likedTracks: liked,
    heard: [...heard.values()],
    liked: new Set(liked.map((t) => String(t.id))),
    disliked: app.disliked,
    profile: buildProfile(input, tree),
    daysSinceHeard,
    now,
  };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

async function buildMixes(g: Gathered, day: string): Promise<Mix[]> {
  const plans = planMixes(g.profile, g.tree);
  const out: Mix[] = [];
  for (const plan of plans) {
    const rand = seededRandom(`${day}:${plan.genre}`);
    const seeds = mixSeeds(plan, 5, rand);
    const similar = (await mapLimit(seeds, CONCURRENCY, (t) => api.similarTracks(t.id))).flat().filter(Boolean) as Track[];
    const tracks = assembleMix(plan, similar, { tree: g.tree, liked: g.liked, disliked: g.disliked, daysSinceHeard: g.daysSinceHeard, rand });
    if (tracks.length >= 10) out.push(makeMix(`mix-${plan.genre}`, 'mix', tracks, plan.artists, plan.genre));
  }
  return out;
}

async function buildDiscover(g: Gathered, week: string): Promise<Mix | undefined> {
  const seeds = discoverSeeds(g.profile, 20, seededRandom(`discover:${week}`));
  const results = await mapLimit(seeds, CONCURRENCY, async (seed) => ({ seed, similar: await api.similarTracks(seed.id) }));
  const tracks = rankDiscoveries(results.filter(Boolean) as { seed: Track; similar: Track[] }[], {
    tree: g.tree,
    liked: g.liked,
    disliked: g.disliked,
    heard: (id) => g.daysSinceHeard(id) < Infinity,
    knownArtists: new Set(g.profile.artists.keys()),
  });
  if (tracks.length < 10) return undefined;
  return makeMix('discover', 'discover', tracks, [...new Set(tracks.flatMap((t) => t.artists.map((a) => a.name)))]);
}

async function buildRadar(g: Gathered): Promise<Mix | undefined> {
  const followed = await api.likedArtists().catch(() => []);
  const artists = radarArtists(g.profile, followed, 30);
  const albums = (await mapLimit(artists, CONCURRENCY, (a) => api.artistAlbums(a.id, 4))).flat().filter(Boolean);
  const recent = recentReleases(albums as NonNullable<(typeof albums)[number]>[], Date.now(), 28).slice(0, 20);
  const full = await mapLimit(recent, CONCURRENCY, async (album) => ({ album, tracks: (await api.album(album.id)).volumes?.flat() ?? [] }));
  const tracks = radarTracks(full.filter(Boolean) as { album: (typeof recent)[number]; tracks: Track[] }[], g.disliked);
  if (!tracks.length) return undefined;
  return makeMix('radar', 'radar', tracks, [...new Set(recent.flatMap((a) => (a.artists || []).map((x) => x.name)))]);
}

/** "On repeat" and one "because you listened to" mix per artist the user is into right now. */
async function buildPersonal(g: Gathered): Promise<Mix[]> {
  const out: Mix[] = [];
  const repeat = onRepeat(g.heard, g.disliked, g.now);
  if (repeat.length >= 10) out.push(makeMix('repeat', 'repeat', repeat, [...new Set(repeat.flatMap((t) => t.artists.map((a) => a.name)))]));

  for (const seed of recentArtists(g.heard, g.now, 3)) {
    const info = await api.artist(seed.id).catch(() => null);
    const similar = (info?.similarArtists || []).slice(0, 6);
    if (!similar.length) continue;
    const tracks = (await mapLimit(similar, CONCURRENCY, (a) => api.artistTracks(a.id, 0, 6))).flat().filter(Boolean) as Track[];
    const picked = becauseYouListened(tracks, {
      liked: g.liked,
      disliked: g.disliked,
      heard: (id) => g.daysSinceHeard(id) < 30,
      exclude: new Set([seed.id]),
    });
    if (picked.length < 8) continue;
    const mix = makeMix(`because-${seed.id}`, 'because', picked, similar.map((a) => a.name));
    mix.seedArtist = seed.name;
    out.push(mix);
  }
  return out;
}

function buildRewind(g: Gathered, week: string): Mix | undefined {
  const tracks = forgottenFavourites(g.likedTracks, g.heard, g.daysSinceHeard, g.disliked, seededRandom(`rewind:${week}`));
  if (tracks.length < 10) return undefined;
  return makeMix('rewind', 'rewind', tracks, [...new Set(tracks.flatMap((t) => t.artists.map((a) => a.name)))]);
}

const ordered = (c: Cache) => {
  const personal = c.personal ?? [];
  const repeat = personal.filter((m) => m.kind === 'repeat');
  const because = personal.filter((m) => m.kind === 'because');
  return [c.discover, c.radar, ...repeat, ...c.mixes, ...because, c.rewind].filter(Boolean) as Mix[];
};

let running: Promise<void> | null = null;

/** Shows cached mixes right away and rebuilds whatever is due. `force` rebuilds everything. */
export function loadRecs(force = false): Promise<void> {
  if (running) return running;
  running = (async () => {
    const uid = String(useApp.getState().account?.uid ?? '');
    if (!uid) return;
    const now = Date.now();
    const day = dayKey(now);
    const discoverWeek = weekKey(now, 1);
    const radarWeek = weekKey(now, 5);
    const cache = readCache(uid);
    if (cache) useRecs.setState({ mixes: ordered(cache), status: 'ready' });

    api
      .personalPlaylists()
      .then((personal) => useRecs.setState({ personal }))
      .catch(() => {});

    const due =
      force || !cache || cache.day !== day || cache.discoverWeek !== discoverWeek || cache.radarWeek !== radarWeek || cache.rewindWeek !== discoverWeek || !cache.personal;
    if (!due) return;
    if (!cache) useRecs.setState({ status: 'loading' });
    try {
      const g = await gather();
      const next: Cache = { ...cache, uid, day, mixes: cache?.mixes ?? [] };
      if (force || cache?.day !== day) next.mixes = await buildMixes(g, day);
      if (force || cache?.day !== day || !cache?.personal) next.personal = await buildPersonal(g);
      if (force || cache?.rewindWeek !== discoverWeek) {
        next.rewind = buildRewind(g, discoverWeek);
        next.rewindWeek = discoverWeek;
      }
      if (force || cache?.discoverWeek !== discoverWeek) {
        next.discover = await buildDiscover(g, discoverWeek);
        next.discoverWeek = discoverWeek;
      }
      if (force || cache?.radarWeek !== radarWeek) {
        next.radar = await buildRadar(g);
        next.radarWeek = radarWeek;
      }
      storage.setItem(CACHE_KEY, JSON.stringify(next));
      useRecs.setState({ mixes: ordered(next), status: 'ready', error: null });
    } catch (e) {
      console.warn('recommendations failed', e);
      if (!cache) useRecs.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export const findMix = (id: string) => useRecs.getState().mixes.find((m) => m.id === id);

export type { Profile };
