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
