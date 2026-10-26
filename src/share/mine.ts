// "+ Mine" (shared.ts says what for): a friend's shared track put into a playlist of one's own —
// its file fetched from his Disk and uploaded to Yandex as one's own upload, so it stays one's own
// (in Yandex's apps too, and when he removes it).

import { api, transport } from '../api/client.ts';
import type { Playlist, Track } from '../api/types.ts';
import { fileName, sharedFileUrl } from './shared.ts';

export async function addToMine(t: Track, pl: Playlist) {
  if (!t.share || !transport.fetchBytes) throw new Error('not a shared track');
  const url = await sharedFileUrl(t.share.link, t.share.file, (r) => transport.request(r));
  const data = await transport.fetchBytes(url);
  await api.upload({ name: fileName(t), data }, pl);
}
