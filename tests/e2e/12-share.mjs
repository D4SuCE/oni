// e2e: shared uploads (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, shot, step, waitPlaying } from './harness.mjs';

await step("shared uploads: a playlist's own uploads go to a folder on Disk opened by a link; read by its link, a track plays from it (a folder of its own, removed again; no marks)", async () => {
  // The user, 26.10.2026: a friend sees one's own uploads. Needs the Disk (YANDEX_DISK_TOKEN) and an uploaded track.
  if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().connected))) return console.log('       skipped: no YANDEX_DISK_TOKEN');
  const kind = await page.evaluate(async () => {
    const { api } = window.__wave;
    for (const p of await api.playlists()) {
      const full = await api.playlist(p.uid, p.kind);
      if ((full.tracks ?? []).some((i) => i.track?.trackSource === 'UGC')) return p.kind;
    }
    return null;
  });
  if (kind === null) return console.log('       skipped: no uploads in the account');
  const folder = `shared-e2e-${Date.now()}`;
  try {
    const link = await page.evaluate(([f, k]) => window.__wave.share.round({ folder: f, only: [k], maxTracks: 2, mark: false }), [folder, kind]);
    if (!link) throw new Error('the round failed');
    const index = await page.evaluate((l) => window.__wave.share.read(l), link);
    const pl = index.playlists[0];
    if (index.playlists.length !== 1 || pl.tracks.length !== 2 || !index.owner.name) throw new Error(`index ${JSON.stringify(index).slice(0, 300)}`);
    await page.evaluate(([l, list]) => window.__wave.playTracks(list.map((x) => window.__wave.share.asTrack(x, l, 'e2e')), 0, 'e2e shared'), [link, pl.tracks]);
    await waitPlaying(1, 60000);
    const playing = await page.evaluate(() => window.__wave.usePlayer.getState().queue[window.__wave.usePlayer.getState().index]?.share?.file);
    if (playing !== pl.tracks[0].file) throw new Error(`playing ${playing}`);
    console.log(`       "${pl.title}": ${pl.tracks.map((t) => t.title).join(', ')} — played from the Disk`);
    // the friend's page: his uploaded playlists by the link, a row per track, Play plays them
    await page.evaluate(() => window.__wave.audio.pause());
    await page.evaluate((l) => window.__wave.navigate({ name: 'shared', link: l, owner: 'e2e' }), link);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="shared-row"]').length === 2, null, { timeout: 20000 });
    await page.click('[data-testid="shared-play"]');
    await waitPlaying(1, 60000);
    await shot('12-shared');
  } finally {
    await page.evaluate(() => window.__wave.audio.pause());
    await page.evaluate(() => window.__wave.navigate({ name: 'home' }));
    await page.evaluate((f) => window.__wave.sync.disk.remove(f), folder);
  }
});

await step('backup: a snapshot holds the playlists in order and Liked; a playlist comes back from it as a new one, a like that left comes back (all removed again)', async () => {
  // The user, 26.10.2026. The test run makes no daily backup of its own: the parts are tried.
  const made = [];
  let liked = null;
  try {
    const chart = await page.evaluate(() => window.__wave.api.chart().then((l) => l.filter((t) => t.available !== false).slice(10, 14)));
    const pl = await page.evaluate(async (tracks) => {
      const { api } = window.__wave;
      const p = await api.createPlaylist('oni-e2e-backup');
      return api.addToPlaylist(p, tracks.slice(0, 3), 0);
    }, chart);
    made.push(pl.kind);
    const copy = await page.evaluate(() => window.__wave.backup.snapshot());
    const kept = copy.playlists.find((p) => String(p.kind) === String(pl.kind));
    const want = chart.slice(0, 3).map((t) => String(t.id));
    if (!kept || kept.tracks.map((x) => x.id).join() !== want.join()) throw new Error(`the copy has ${JSON.stringify(kept)}`);
    if (!copy.likes.length) throw new Error('no likes in the copy');
    const back = await page.evaluate(([c, k]) => window.__wave.backup.restorePlaylist(c, k, 'oni-e2e-backup restored'), [copy, pl.kind]);
    made.push(back.kind);
    const again = await page.evaluate((k) => window.__wave.api.playlist(window.__wave.useApp.getState().account.uid, k, false), back.kind);
    if ((again.tracks ?? []).map((i) => String(i.id)).join() !== want.join()) throw new Error(`restored ${JSON.stringify((again.tracks ?? []).map((i) => i.id))}`);
    // a like that is not there now comes back from a copy that had it
    const free = await page.evaluate((list) => { const l = window.__wave.useApp.getState().liked; return list.find((t) => !l.has(String(t.id))) ?? null; }, chart);
    if (free) {
      const key = free.albums?.[0]?.id ? `${free.id}:${free.albums[0].id}` : String(free.id);
      liked = key;
      const n = await page.evaluate((k) => window.__wave.backup.restoreLikes({ v: 1, at: 0, likes: [k], playlists: [] }), key);
      if (n !== 1) throw new Error(`likes restored: ${n}`);
    }
    console.log(`       ${copy.playlists.length} playlists, ${copy.likes.length} likes in the copy; a playlist and ${free ? 'a like' : 'no like'} brought back`);
  } finally {
    if (liked) await page.evaluate((k) => window.__wave.api.setLiked([k], false), liked);
    for (const k of made) await page.evaluate((kind) => window.__wave.api.deletePlaylist(kind), k);
  }
});
