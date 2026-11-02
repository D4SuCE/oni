// A friend's playlist in full (the user, 2.11.2026: "he opens my playlist, and it has the same order,
// with the uploaded tracks"): Yandex gives anyone else a playlist without its uploads, so the index on
// the owner's Disk (shared.ts) puts them back, each in its place. They play, download and go to
// "+ Mine" as on the uploads' page.

import { useCallback, useEffect } from 'react';
import { api, transport } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { useAsync } from '../ui/util.ts';
import { readShared, shareLinkOf, withUploads, type SharedIndex } from './shared.ts';

/** A Disk that does not answer leaves Yandex's list as it is, with its buttons working. */
const PATIENCE = 15_000;

const request: Parameters<typeof readShared>[1] = (r) => transport.request(r);

/** The owner's index for this playlist of theirs; none shared, or out of reach: null. */
async function indexOf(pl: Playlist) {
  const link = await shareLinkOf(pl, (uid) => api.userPlaylists(uid));
  if (!link) return null;
  const late = new Promise<null>((done) => setTimeout(() => done(null), PATIENCE));
  const index = await Promise.race([readShared(link, request).catch(() => null), late]);
  return index && { link, index };
}

const placed = (tracks: Track[], pl: Playlist, found: { link: string; index: SharedIndex }) =>
  withUploads(tracks, found.index.playlists.find((p) => String(p.kind) === String(pl.kind)), found.link, found.index.owner.name || pl.owner?.name || '');

/** A friend's playlist from its menu: played, downloaded whole, without its page. */
export async function friendsList(pl: Playlist, tracks: Track[]): Promise<Track[]> {
  const found = await indexOf(pl);
  return found ? placed(tracks, pl, found) : tracks;
}

/** For a playlist's page. `skip`: one's own, or no network (a kept list has them already).
 * `waiting`: the index has not come yet (a playlist of uploads alone looks empty till then);
 * `place`: Yandex's tracks with the uploads in them. */
export function useFriendUploads(pl: Playlist | null | undefined, skip: boolean) {
  const key = pl && !skip ? `${pl.uid}:${pl.kind}` : null;
  const { data, loading, setData } = useAsync(async () => ({ key, found: key ? await indexOf(pl!) : null }), [key, pl?.description]);
  const found = data?.key === key ? data?.found : null;
  // the owner's Oni still putting tracks there: looked at again every 10 s, the new ones show
  const pending = found?.index.pending ?? 0;
  const link = found?.link;
  useEffect(() => {
    if (!pending || !link) return;
    const timer = setInterval(() => void readShared(link, request).then((index) => setData({ key, found: { link, index } }), () => {}), 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, link, pending]);
  const place = useCallback((tracks: Track[]) => (pl && found ? placed(tracks, pl, found) : tracks), [pl, found]);
  return { waiting: Boolean(key) && (loading || data?.key !== key), place };
}
