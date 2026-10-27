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
    // the round, and its folder looked at meanwhile: its index is there before all the files are
    // (a friend sees them come), with how many are on their way
    const [link, early] = await page.evaluate(async ([f, k]) => {
      const { share, sync } = window.__wave;
      let over = false;
      const going = share.round({ folder: f, only: [k], maxTracks: 4, mark: false }).finally(() => (over = true));
      let seen = null;
      while (!over && !seen) {
        const index = await sync.disk.read(`${f}/index.json`).then((t) => JSON.parse(t), () => null);
        if (index?.pending) seen = index;
      }
      return [await going, seen];
    }, [folder, kind]);
    if (!early) throw new Error('no index while the files went up');
    if (!link) throw new Error(`the round failed: ${await page.evaluate(() => window.__wave.share.useShare?.getState().error)}`);
    const index = await page.evaluate((l) => window.__wave.share.read(l), link);
    const pl = index.playlists[0];
    // at the end every track is listed and none is on its way (the index went up first, then grew)
    if (index.playlists.length !== 1 || pl.tracks.length < 2 || !index.owner.name || index.pending) throw new Error(`index ${JSON.stringify(index).slice(0, 300)}`);
    await page.evaluate(([l, list]) => window.__wave.playTracks(list.map((x) => window.__wave.share.asTrack(x, l, 'e2e')), 0, 'e2e shared'), [link, pl.tracks]);
    await waitPlaying(1, 60000);
    const playing = await page.evaluate(() => window.__wave.usePlayer.getState().queue[window.__wave.usePlayer.getState().index]?.share?.file);
    if (playing !== pl.tracks[0].file) throw new Error(`playing ${playing}`);
    // a friend downloads one: kept on the device, its file from the owner's Disk (removed again)
    const one = await page.evaluate(([l, x]) => window.__wave.share.asTrack(x, l, 'e2e'), [link, pl.tracks[1]]);
    try {
      await page.evaluate((t) => window.__wave.share.downloadShared(t), one);
      const kept = await page.evaluate((id) => window.__wave.offline.entry(id)?.size ?? 0, one.id);
      if (kept < 50000) throw new Error(`downloaded ${kept} bytes`);
    } finally {
      await page.evaluate((id) => window.__wave.offline.remove(id), one.id);
    }
    console.log(`       "${pl.title}": the index there with ${early.pending} on their way; ${pl.tracks.map((t) => t.title).join(', ')} — played from the Disk, one downloaded`);
    // the friend's page: his uploaded playlists by the link, a row per track, Play plays them
    await page.evaluate(() => window.__wave.audio.pause());
    await page.evaluate((l) => window.__wave.navigate({ name: 'shared', link: l, owner: 'e2e' }), link);
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="shared-row"]').length === n, pl.tracks.length, { timeout: 20000 });
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

await step("backup: each device's downloads are listed; own uploads kept as files, each track once beside the shared ones (met again: nothing sent; an old copy's file moved in by Disk); a playlist with an upload comes back (a folder of its own, removed again)", async () => {
  // The user, 26.10.2026: "keep the likes, add the downloaded list, and the uploads by playlist as the songs themselves".
  const copy = await page.evaluate(() => window.__wave.backup.snapshot());
  const mine = Object.values(copy.downloads ?? {});
  const have = await page.evaluate(() => window.__wave.offline?.entries().length ?? 0);
  if (mine.length !== 1 || mine[0].tracks.length !== have) throw new Error(`downloads in the copy: ${JSON.stringify(copy.downloads).slice(0, 200)}, ${have} here`);
  if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().connected))) return console.log(`       ${have} downloads listed; the files skipped: no YANDEX_DISK_TOKEN`);
  const met = await page.evaluate(async () => {
    const { api } = window.__wave;
    for (const p of await api.playlists()) {
      const full = await api.playlist(p.uid, p.kind);
      const ugc = (full.tracks ?? []).filter((i) => i.track?.trackSource === 'UGC' && i.track.available !== false).slice(0, 2);
      if (ugc.length) return { kind: p.kind, title: p.title, tracks: ugc.map((i) => i.track) };
    }
    return null;
  });
  if (!met) return console.log(`       ${have} downloads listed; the files skipped: no uploads in the account`);
  const root = `backup-e2e-${Date.now()}`;
  let made = null;
  try {
    const first = await page.evaluate(([m, r]) => window.__wave.backup.keepUploads(m.tracks, {}, r), [met, root]);
    const files = Object.values(first).flatMap((u) => u.files);
    if (files.length !== met.tracks.length || !files.every((f, i) => f === `${root}/${met.tracks[i].id}.mp3`)) throw new Error(`kept ${JSON.stringify(first)}`);
    const sizes = await page.evaluate((fs) => Promise.all(fs.map((f) => window.__wave.sync.disk.readBytes(f).then((b) => b.byteLength))), files);
    if (sizes.some((n) => n < 50000)) throw new Error(`file sizes ${sizes}`);
    // the same tracks again (another playlist, the next day): the same files, nothing new
    const again = await page.evaluate(([m, r, before]) => window.__wave.backup.keepUploads(m.tracks, before, r), [met, root, first]);
    if (JSON.stringify(again) !== JSON.stringify(first)) throw new Error(`again ${JSON.stringify(again)}`);
    // a copy made before 27.10.2026 kept its file in a folder of its own: Disk moves it in, nothing sent
    const t = met.tracks[0];
    const old = `${root}/old/${t.id}.mp3`;
    const moved = await page.evaluate(async ([tr, r, f, o]) => {
      const { disk } = window.__wave.sync;
      await disk.mkdir(`${r}/old`);
      await disk.copy(f, o);
      const out = await window.__wave.backup.keepUploads([tr], { [tr.id]: { title: tr.title, artists: [], files: [o] } }, `${r}/pool`);
      return { out, old: (await disk.folder(`${r}/old`)).length, pool: (await disk.folder(`${r}/pool`)).map((x) => x.size) };
    }, [t, root, files[0], old]);
    if (moved.old !== 0 || moved.pool.length !== 1 || moved.pool[0] !== sizes[0]) throw new Error(`moved ${JSON.stringify(moved)}`);
    // a playlist of a copy, its uploads still Yandex's: they come back by their ids, none sent again
    const backup = { v: 1, at: 0, likes: [], playlists: [{ kind: met.kind, title: met.title, tracks: met.tracks.map((t) => ({ id: String(t.id) })) }], uploads: first };
    made = await page.evaluate((b) => window.__wave.backup.restorePlaylist(b, b.playlists[0].kind, 'oni-e2e-backup uploads'), backup);
    const ids = await page.evaluate((k) => window.__wave.api.playlist(window.__wave.useApp.getState().account.uid, k, false).then((p) => (p.tracks ?? []).map((i) => String(i.id))), made.kind);
    if (made.lost || ids.join() !== met.tracks.map((t) => String(t.id)).join()) throw new Error(`restored ${ids}, lost ${made.lost}`);
    console.log(`       ${have} downloads listed; "${met.title}": ${files.length} own mp3s kept (${sizes.map((n) => Math.round(n / 1024)).join(', ')} KB), once; an old file moved in; brought back`);
  } finally {
    if (made) await page.evaluate((k) => window.__wave.api.deletePlaylist(k), made.kind);
    await page.evaluate((r) => window.__wave.sync.disk.remove(r), root);
  }
});

await step('downloads: one Yandex took away is marked to keep, one it still gives is not (a download of its own, removed again)', async () => {
  // The user, 26.10.2026: "Pink Blush" gone from Yandex (and from Liked) the day after the like.
  const track = await page.evaluate(() => window.__wave.api.chart().then((l) => l.find((t) => t.available !== false && !window.__wave.offline.has(t.id))));
  try {
    await page.evaluate((t) => window.__wave.offline.download(t), track);
    await page.evaluate(() => window.__wave.backup.keepGoneDownloads());
    if (await page.evaluate((id) => window.__wave.offline.entry(id).gone, track.id)) throw new Error('an available download marked gone');
    // a list showing it unavailable marks it; a copy of a gone one plays (player.ts, playable)
    await page.evaluate((t) => window.__wave.offline.keepGone([{ ...t, available: false }]), track);
    if (!(await page.evaluate((id) => window.__wave.offline.entry(id).gone, track.id))) throw new Error('not marked');
    await page.evaluate((t) => window.__wave.playTracks([{ ...t, available: false }], 0, 'e2e gone'), track);
    await waitPlaying(1, 30000);
    console.log(`       "${track.title}": kept, and plays from its copy as gone`);
  } finally {
    await page.evaluate(() => window.__wave.audio.pause());
    await page.evaluate((id) => window.__wave.offline.remove(id), track.id);
  }
});
