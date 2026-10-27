// e2e: history sync (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, step, shot, player, waitPlaying } from './harness.mjs';

await step('a track is in History after 5 s while it still plays, not only once the next one starts', async () => {
  // Found by the user: a track heard almost to its end, then Oni closed, never reached History.
  await page.click('[data-testid="next"]');
  await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.audio.currentTime < 3, null, { timeout: 20000 });
  const title = (await player()).title;
  await waitPlaying(7, 30000);
  await page.click('[data-testid="nav-history"]');
  await page.click('[data-testid="history-app"]');
  const first = await page.locator('.history-group .track-row .tr-title').first().innerText();
  if (!first.includes(title)) throw new Error(`playing "${title}", History starts with "${first}"`);
  if ((await player()).title !== title) throw new Error('the track changed meanwhile');
});

await step('history: this app and all devices', async () => {
  await page.click('[data-testid="nav-history"]');
  // Earlier steps played several tracks for longer than the 5 s that counts as a play.
  await page.waitForSelector('.history-group .track-row', { timeout: 10000 });
  const local = await page.locator('.history-group').count();
  await page.click('[data-testid="history-yandex"]');
  await page.waitForSelector('.history-group .track-row, .empty-hint, .error-box', { timeout: 30000 });
  if (await page.locator('.error-box').count()) throw new Error(await page.locator('.error-box').innerText());
  console.log(`       in this app: ${local} groups; from Yandex: ${await page.locator('.history-group .track-row').count()} tracks`);
  await shot('13-history');
  // Found by the user: a track started from History showed "My Wave" (the run's source) on the home
  // banner, not where it was started from. Both tabs: Yandex's, then this app's.
  for (const tab of ['history-yandex', 'history-app']) {
    await page.click(`[data-testid="${tab}"]`);
    await page.locator('.history-group .track-row').first().dblclick();
    await page.waitForFunction(() => window.__wave.usePlayer.getState().source?.kind === 'list', null, { timeout: 15000 });
    const title = await page.evaluate(() => window.__wave.usePlayer.getState().source?.title);
    if (title !== 'История') throw new Error(`${tab}: playing from "${title}", not "История"`);
  }
  await page.click('[data-testid="nav-home"]');
  const kicker = await page.locator('[data-testid="wave-kicker"]').innerText();
  if (!/история/i.test(kicker)) throw new Error(`home banner: "${kicker}"`);
  await page.evaluate(() => window.__wave.audio.pause());
  await page.click('[data-testid="nav-history"]');
});

await step("shared history: another device's plays come from Oni's folder on Yandex Disk, and this one's go up (all removed again)", async () => {
  // Needs YANDEX_DISK_TOKEN (the app-folder token, a development build reads it like the music token).
  if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().connected))) {
    console.log('       skipped: no YANDEX_DISK_TOKEN');
    return;
  }
  const phone = `device-e2e${Date.now()}.json`;
  const own = await page.evaluate(() => window.__wave.sync.deviceSync.fileName);
  try {
    const track = await page.evaluate(() => {
      const s = window.__wave.usePlayer.getState();
      return s.queue[s.index] ?? s.queue[0];
    });
    if (!track) throw new Error('nothing played yet');
    const at = Date.now() - 60_000;
    const file = {
      v: 1,
      device: { id: phone.slice(7, -5), platform: 'ios' },
      at,
      history: { '999000111': { plays: 2, skips: 0, last: at } },
      log: { plays: [], tracks: {} },
      recent: [{ track, at, source: 'e2e phone' }],
    };
    // Yandex's network fails now and then ("fetch failed"): one more try before the step fails.
    const put = () => page.evaluate(([name, text]) => window.__wave.sync.disk.write(name, text), [phone, JSON.stringify(file)]);
    await put().catch(() => page.waitForTimeout(3000).then(put));
    await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
    // A round may fail on Yandex's network now and then ("fetch failed"): pressed again, as one would.
    for (let i = 0; i < 3; i++) {
      await page.click('[data-testid="sync-now"]');
      const done = await page.waitForFunction(() => !window.__wave.sync.useSync.getState().busy && window.__wave.sync.useSync.getState().at, null, { timeout: 30000 }).then(() => true, () => false);
      if (done) break;
    }
    if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().at))) throw new Error('three rounds of syncing did not go through');
    const devices = await page.locator('[data-testid="sync-devices"]').innerText();
    if (!/iPhone/.test(devices)) throw new Error(`devices: "${devices}"`);
    const listed = await page.evaluate(() => window.__wave.sync.disk.list());
    if (!listed.some((f) => f.name === own)) throw new Error(`own file not on Disk: ${listed.map((f) => f.name)}`);
    await page.click('[data-testid="nav-history"]');
    await page.click('[data-testid="history-app"]');
    const run = page.locator('.history-context', { hasText: 'e2e phone' }).first();
    await run.waitFor({ timeout: 5000 });
    if (!/iPhone/.test(await run.innerText())) throw new Error(`run: "${await run.innerText()}"`);
  } finally {
    await page.evaluate(([a, b]) => Promise.all([window.__wave.sync.disk.remove(a), window.__wave.sync.disk.remove(b)]), [phone, own]);
    await page.evaluate(() => window.__wave.sync.deviceSync.clear());
  }
  const left = await page.evaluate(() => window.__wave.sync.disk.list());
  if (left.some((f) => f.name === phone || f.name === own)) throw new Error('files left on Disk');
});

await step('another device in the player: its paused track taken up at its second; its playing one shown with the time going, Next and the volume pressed there; "Disconnect" brings back what was here; its presses and volume done here (all removed again)', async () => {
  // The user, 24.10.2026: "continue on another device" and the remote, through Oni's folder on Disk.
  if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().connected))) {
    console.log('       skipped: no YANDEX_DISK_TOKEN');
    return;
  }
  const phoneId = `e2ephone${Date.now()}`;
  const ownId = await page.evaluate(() => window.__wave.sync.deviceSync.device.id);
  const names = [`now-${phoneId}.json`, `cmd-${phoneId}-${ownId}.json`, `cmd-${ownId}-${phoneId}.json`, `now-${ownId}.json`, `now-${phoneId}b.json`];
  const write = (name, file) => page.evaluate(([n, t]) => window.__wave.sync.disk.write(n, t), [name, JSON.stringify(file)]);
  const read = (name) => page.evaluate((n) => window.__wave.sync.disk.read(n).then((t) => JSON.parse(t)), name).catch((e) => {
    throw new Error(`${name}: ${e.message.split('\n')[0]}`);
  });
  const ownVolume = await page.evaluate(() => window.__wave.usePlayer.getState().volume);
  try {
    await page.evaluate(() => window.__wave.audio.pause());
    await page.waitForFunction(() => !window.__wave.usePlayer.getState().playing);
    const queue = await page.evaluate(() => window.__wave.api.chart().then((l) => l.filter((t) => t.available !== false).slice(0, 3)));
    if (queue.length < 3) throw new Error(`only ${queue.length} tracks to work with`);
    const phone = (over) => ({
      v: 1, device: { id: phoneId, platform: 'ios' }, queue, index: 1, offset: 0, title: 'e2e phone list', playing: false, position: 40,
      duration: (queue[1].durationMs || 180000) / 1000, shuffle: false, repeat: 'off', at: Date.now(), changed: Date.now() + 1000, test: true, ...over,
    });

    // 1. Paused there, changed later than here: taken up here, paused at the same second, no banner.
    await write(names[0], phone());
    // Disk lists a file just written a little late at times: looked at again, as Oni does.
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.__wave.sync.elsewhere.look(true));
      if (await page.evaluate((id) => { const s = window.__wave.usePlayer.getState(); return s.queue[s.index]?.id === id; }, queue[1].id)) break;
      await page.waitForTimeout(1000);
    }
    const taken = await page.evaluate(() => { const s = window.__wave.usePlayer.getState(); return { id: s.queue[s.index]?.id, position: s.position, playing: s.playing, title: s.source?.title }; });
    if (taken.id !== queue[1].id || Math.round(taken.position) !== 40 || taken.playing || taken.title !== 'e2e phone list') throw new Error(`taken up: ${JSON.stringify(taken)}`);
    if (await page.locator('[data-testid="playing-on"]').count()) throw new Error('a remote, not a take-over');

    // 2. Playing there: this one is its remote — its track, "Playing on iPhone", the time going on.
    await write(names[0], phone({ playing: true, position: 60, changed: Date.now() + 2000 }));
    // Disk lists a file just written a little late at times (a full run, 25.10.2026): looked at again, as Oni does.
    for (let i = 0; i < 8 && !(await page.locator('[data-testid="playing-on"]').count()); i++) {
      await page.evaluate(() => window.__wave.sync.elsewhere.look(true));
      await page.waitForTimeout(i ? 1000 : 300);
    }
    await page.locator('[data-testid="playing-on"]').first().waitFor({ timeout: 5000 });
    const on = await page.locator('[data-testid="playing-on"]').first().innerText();
    if (!/iPhone/.test(on)) throw new Error(`playing on: "${on}"`);
    const p1 = await page.evaluate(() => window.__wave.usePlayer.getState().position);
    await page.waitForTimeout(1500);
    const p2 = await page.evaluate(() => window.__wave.usePlayer.getState().position);
    if (!(p1 >= 59 && p2 > p1 + 0.8)) throw new Error(`time: ${p1} → ${p2}`);
    if (!(await page.evaluate(() => window.__wave.audio.paused))) throw new Error('this one plays too');

    // Next goes there (its file), and shows here at once.
    await page.click('[data-testid="next"]');
    await page.waitForFunction((id) => { const s = window.__wave.usePlayer.getState(); return s.queue[s.index]?.id === id; }, queue[2].id, { timeout: 3000 });
    // The press goes up on its own after it shows: read once it is there.
    let sent = null;
    for (let i = 0; i < 15 && !sent?.commands?.some((c) => c.fn === 'next'); i++) sent = await read(names[1]).catch(() => page.waitForTimeout(1000).then(() => null));
    if (!sent) throw new Error('the press never went up');
    if (sent.commands.at(-1)?.fn !== 'next') throw new Error(`sent: ${JSON.stringify(sent.commands)}`);

    // The volume goes there too, and this one's own stays (the user, 25.10.2026: "the remote in full").
    await page.keyboard.press('Control+ArrowDown');
    let turned = null;
    for (let i = 0; i < 15 && !turned; i++) turned = await read(names[1]).then((f) => f.commands.find((c) => c.fn === 'volume'), () => null) ?? (await page.waitForTimeout(1000), null);
    if (!(Math.abs(turned?.args[0] - Math.max(0, ownVolume - 0.05)) < 0.001)) throw new Error(`volume sent: ${JSON.stringify(turned)} (own ${ownVolume})`);

    // 3. "Disconnect": not a remote; what was here before comes back as it was (the phone's paused track
    // taken up, at 40 s), paused; and this one's own volume (the user: My Wave was gone after it).
    await page.evaluate(() => window.__wave.sync.elsewhere.disconnect());
    const back = await page.evaluate(() => { const s = window.__wave.usePlayer.getState(); return { id: s.queue[s.index]?.id, position: s.position, playing: s.playing, title: s.source?.title, volume: s.volume }; });
    if (back.id !== queue[1].id || Math.round(back.position) !== 40 || back.playing || back.title !== 'e2e phone list' || back.volume !== ownVolume) throw new Error(`back: ${JSON.stringify(back)}`);
    if (await page.locator('[data-testid="playing-on"]').count()) throw new Error('still a remote');

    // 4. The phone as this one's remote: its Play and its volume are done here, then its Pause.
    const at = Date.now();
    await write(names[2], { v: 1, from: { id: phoneId, platform: 'ios' }, at, commands: [{ id: `${phoneId}.1`, at, fn: 'play', args: [] }, { id: `${phoneId}.2`, at: at + 1, fn: 'volume', args: [0.3] }] });
    await page.evaluate(() => window.__wave.sync.elsewhere.look());
    await waitPlaying(0.5);
    const loud = await page.evaluate(() => window.__wave.usePlayer.getState().volume);
    if (loud !== 0.3) throw new Error(`volume from the phone: ${loud}`);
    await write(names[2], { v: 1, from: { id: phoneId, platform: 'ios' }, at: Date.now(), commands: [{ id: `${phoneId}.3`, at: Date.now(), fn: 'pause', args: [] }] });
    await page.evaluate(() => window.__wave.sync.elsewhere.look());
    await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 5000 });
    await page.evaluate(() => window.__wave.sync.elsewhere.publish());
    const mine = await read(names[3]);
    if (mine.playing || mine.queue[mine.index]?.id !== queue[1].id || mine.volume !== 0.3 || !mine.test) throw new Error(`own file: playing ${mine.playing}, ${mine.queue[mine.index]?.id}, volume ${mine.volume}, test ${mine.test}`);

    // 5. The phone's Oni not there for a while (its file not renewed): not offered as a remote (the
    // user, 25.10.2026: the PC's track shown on the phone with the PC off).
    // (A second phone: a file older than one already read is not taken, so the first cannot be aged.)
    const listed = (id) => page.evaluate((i) => window.__wave.sync.elsewhere.useElsewhere.getState().devices.some((d) => d.device.id === i), id);
    // The phone renews its file while open (its last one may be older than a minute by now).
    await write(names[0], phone({ at: Date.now(), changed: Date.now() + 20_000 }));
    for (let i = 0; i < 8 && !(await listed(phoneId)); i++) {
      await page.evaluate(() => window.__wave.sync.elsewhere.look());
      await page.waitForTimeout(i ? 1000 : 300);
    }
    if (!(await listed(phoneId))) throw new Error('the phone, open, not listed');
    await write(names[4], phone({ device: { id: `${phoneId}b`, platform: 'ios' }, at: Date.now() - 200_000 }));
    await page.evaluate(() => window.__wave.sync.elsewhere.look());
    if (await listed(`${phoneId}b`)) throw new Error('a phone away (its file not renewed) listed');
    if (!(await listed(phoneId))) throw new Error('the open phone gone from the list');
  } finally {
    await page.evaluate((v) => window.__wave.setVolume(v), ownVolume);
    await page.evaluate(() => window.__wave.sync.elsewhere.leave('drop'));
    await page.evaluate((list) => Promise.all(list.map((n) => window.__wave.sync.disk.remove(n).catch(() => {}))), names);
  }
  const left = await page.evaluate(() => window.__wave.sync.disk.list());
  if (left.some((f) => names.includes(f.name))) throw new Error('files left on Disk');
});

await step('the full remote: what a remote starts (a list, «Своя волна», a My Wave pick) goes to the device it controls and plays there, not here; a list sent by its keys and «Своя волна» from a phone play here (all removed again)', async () => {
  // The user, 25.10.2026: "connected from the phone to the PC, I want to do everything there".
  if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().connected))) {
    console.log('       skipped: no YANDEX_DISK_TOKEN');
    return;
  }
  const phoneId = `e2efull${Date.now()}`;
  const ownId = await page.evaluate(() => window.__wave.sync.deviceSync.device.id);
  const names = [`now-${phoneId}.json`, `cmd-${phoneId}-${ownId}.json`, `cmd-${ownId}-${phoneId}.json`];
  const write = (name, file) => page.evaluate(([n, t]) => window.__wave.sync.disk.write(n, t), [name, JSON.stringify(file)]);
  const read = (name) => page.evaluate((n) => window.__wave.sync.disk.read(n).then((t) => JSON.parse(t)), name);
  /** Disk lists a file just written a little late at times: looked at again until `cond`, as Oni does. */
  const lookUntil = async (cond, arg) => {
    for (let i = 0; i < 15; i++) {
      await page.evaluate(() => window.__wave.sync.elsewhere.look());
      if (await page.evaluate(cond, arg)) return;
      await page.waitForTimeout(1000);
    }
    throw new Error(`not so after 15 s: ${cond}`);
  };
  /** The command sent there, once it is up (a press goes up on its own a moment after). 30 s: through
   * the user's VPN the Disk took longer than 15 at times (on GitHub, without one, it passed, 27.10.2026). */
  const sent = async (fn) => {
    for (let i = 0; i < 30; i++) {
      const c = await read(names[1]).then((f) => f.commands.filter((x) => x.fn === fn).at(-1), () => null);
      if (c) return c;
      await page.waitForTimeout(1000);
    }
    throw new Error(`"${fn}" never went up`);
  };
  try {
    await page.evaluate(() => window.__wave.audio.pause());
    const chart = await page.evaluate(() => window.__wave.api.chart().then((l) => l.filter((t) => t.available !== false).slice(0, 4)));
    await write(names[0], {
      v: 1, device: { id: phoneId, platform: 'ios' }, queue: chart, index: 0, offset: 0, title: 'e2e phone', playing: true, position: 30,
      duration: (chart[0].durationMs || 180000) / 1000, shuffle: false, repeat: 'off', at: Date.now(), changed: Date.now() + 5000, test: true,
    });
    for (let i = 0; i < 8 && !(await page.locator('[data-testid="playing-on"]').count()); i++) {
      await page.evaluate(() => window.__wave.sync.elsewhere.look(true));
      await page.waitForTimeout(i ? 1000 : 300);
    }
    await page.locator('[data-testid="playing-on"]').first().waitFor({ timeout: 5000 });

    // 1. This one is the remote: a list started here goes there, with its tracks; nothing plays here.
    await page.evaluate((list) => window.__wave.playTracks(list, 1, 'e2e remote list'), chart.slice(0, 3));
    const list = await sent('playTracks');
    if (list.args[0]?.tracks?.length !== 3 || list.args[1] !== 1 || list.args[2] !== 'e2e remote list') throw new Error(`list sent: ${JSON.stringify(list.args).slice(0, 200)}`);
    // «Своя волна» by its button, and a My Wave pick in "Tune".
    await page.click('[data-testid="nav-home"]');
    await page.click('[data-testid="own-wave"]');
    await sent('playOwnWave');
    await page.click('[data-testid="wave-tune"]');
    await page.locator('.segmented').nth(1).locator('button', { hasText: 'Грустное' }).click();
    const pick = await sent('retuneWave');
    if (pick.args[0]?.mood !== 'sad') throw new Error(`pick sent: ${JSON.stringify(pick.args)}`);
    await page.locator('.segmented').nth(1).locator('button', { hasText: 'Любое' }).click();
    await page.keyboard.press('Escape');
    await page.locator('.drawer-backdrop').click({ position: { x: 5, y: 5 } }).catch(() => {});
    if (!(await page.evaluate(() => window.__wave.audio.paused))) throw new Error('it played here too');
    if (!(await page.locator('[data-testid="playing-on"]').count())) throw new Error('no longer a remote');

    // 2. The phone as this one's remote: a list sent by its keys plays here, then «Своя волна».
    const keys = chart.map((t) => (t.albums?.[0]?.id ? `${t.id}:${t.albums[0].id}` : String(t.id)));
    const at = Date.now();
    await write(names[2], { v: 1, from: { id: phoneId, platform: 'ios' }, at, commands: [{ id: `${phoneId}.1`, at, fn: 'playTracks', args: [{ keys }, 2, 'e2e from the phone', undefined, {}] }] });
    await lookUntil(() => window.__wave.usePlayer.getState().source?.title === 'e2e from the phone');
    const here = await page.evaluate(() => { const s = window.__wave.usePlayer.getState(); return { n: s.queue.length, id: String(s.queue[s.index]?.id) }; });
    if (here.n !== 4 || here.id !== String(chart[2].id)) throw new Error(`the phone's list here: ${JSON.stringify(here)}`);
    await waitPlaying(0.5);
    await write(names[2], { v: 1, from: { id: phoneId, platform: 'ios' }, at: Date.now(), commands: [{ id: `${phoneId}.2`, at: Date.now(), fn: 'playOwnWave', args: [] }] });
    await lookUntil(() => window.__wave.usePlayer.getState().source?.station?.seed === 'oni:own');
    await waitPlaying(0.5, 60000);
  } finally {
    await page.evaluate(() => window.__wave.audio.pause());
    await page.evaluate(() => window.__wave.sync.elsewhere.leave('drop'));
    await page.evaluate((list) => Promise.all(list.map((n) => window.__wave.sync.disk.remove(n).catch(() => {}))), names);
  }
});

await step('who controls whom: a phone that is this one\'s remote is never made its remote ("Controlled from iPhone"); becoming a remote says so on Disk; a press while each is the other\'s remote is done; "Disconnect" leaves the phone playing and is not undone by itself (all removed again)', async () => {
  // The user, 25.10.2026: Pause from the phone did nothing until Oni was opened again (each device was
  // the other's remote), and leaving the remote on the phone paused the PC and played on the phone.
  if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().connected))) {
    console.log('       skipped: no YANDEX_DISK_TOKEN');
    return;
  }
  const phoneId = `e2ephone${Date.now()}`;
  const ownId = await page.evaluate(() => window.__wave.sync.deviceSync.device.id);
  const names = [`now-${phoneId}.json`, `cmd-${phoneId}-${ownId}.json`, `cmd-${ownId}-${phoneId}.json`, `now-${ownId}.json`];
  const write = (name, file) => page.evaluate(([n, t]) => window.__wave.sync.disk.write(n, t), [name, JSON.stringify(file)]);
  const read = (name) => page.evaluate((n) => window.__wave.sync.disk.read(n).then((t) => JSON.parse(t)), name);
  const look = (around = true) => page.evaluate((a) => window.__wave.sync.elsewhere.look(a), around);
  const playingOn = async () => ((await page.locator('[data-testid="playing-on"]').count()) ? page.locator('[data-testid="playing-on"]').first().innerText() : '');
  const currentId = () => page.evaluate(() => { const s = window.__wave.usePlayer.getState(); return s.queue[s.index]?.id; });
  try {
    const queue = await page.evaluate(() => window.__wave.api.chart().then((l) => l.filter((t) => t.available !== false).slice(3, 6)));
    const phone = (over) => ({
      v: 1, device: { id: phoneId, platform: 'ios' }, queue, index: 0, offset: 0, title: 'e2e phone list', playing: true, position: 20,
      duration: (queue[0].durationMs || 180000) / 1000, shuffle: false, repeat: 'off', at: Date.now(), changed: Date.now() + 5000, test: true, ...over,
    });
    await page.evaluate(() => window.__wave.audio.pause());
    await page.waitForFunction(() => !window.__wave.usePlayer.getState().playing);
    const mine = await currentId();

    // 1. The phone is this one's remote (its file says so, and it looks on): this one, paused, neither
    // takes up its track nor becomes its remote, and says who controls it.
    await write(names[0], phone({ playing: false, remoteOf: ownId }));
    await write(names[2], { v: 1, from: { id: phoneId, platform: 'ios' }, at: Date.now(), commands: [] });
    // Disk lists a file just written a little late at times: looked at again, as Oni does.
    for (let i = 0; i < 8 && !(await page.evaluate(() => window.__wave.sync.elsewhere.useElsewhere.getState().remotes.length)); i++) {
      await look();
      await page.waitForTimeout(i ? 1000 : 300);
    }
    await page.waitForFunction(() => window.__wave.sync.elsewhere.useElsewhere.getState().remotes.length, null, { timeout: 5000 });
    const shown = await playingOn();
    if (!/Управляет iPhone/.test(shown) || (await currentId()) !== mine) throw new Error(`with the phone as its remote: "${shown}", track ${await currentId()} (was ${mine})`);

    // 2. Playing there: this one becomes its remote, and its own file says so (nothing plays here).
    await write(names[0], phone());
    await look();
    if (!/Играет на iPhone/.test(await playingOn())) throw new Error(`not a remote: "${await playingOn()}"`);
    let own = null;
    for (let i = 0; i < 10 && !own?.remoteOf; i++) own = await page.waitForTimeout(500).then(() => read(names[3])).catch(() => null);
    if (own?.remoteOf !== phoneId || own.playing) throw new Error(`own file: ${JSON.stringify(own && { remoteOf: own.remoteOf, playing: own.playing })}`);

    // 3. A press from the phone all the same (it took this one for the player): done here.
    await write(names[2], { v: 1, from: { id: phoneId, platform: 'ios' }, at: Date.now(), commands: [{ id: `${phoneId}.1`, at: Date.now(), fn: 'toggle', args: [] }] });
    await look(false);
    await waitPlaying(1);
    if (/Играет на/.test(await playingOn())) throw new Error('still a remote after a press for it');

    // 4. "Disconnect": not a remote; the phone was not paused, nothing plays here; told "not watching".
    await page.evaluate(() => window.__wave.audio.pause());
    await page.waitForFunction(() => !window.__wave.usePlayer.getState().playing);
    await write(names[0], phone({ changed: Date.now() + 10_000 }));
    await look();
    if (!/Играет на iPhone/.test(await playingOn())) throw new Error(`not a remote again: "${await playingOn()}"`);
    const since = Date.now();
    await page.evaluate(() => window.__wave.sync.elsewhere.disconnect());
    await page.waitForTimeout(1500);
    if (/Играет на/.test(await playingOn())) throw new Error('still a remote after "Disconnect"');
    if (!(await page.evaluate(() => window.__wave.audio.paused))) throw new Error('plays here after "Disconnect"');
    const told = await read(names[1]);
    if (told.at !== 0 || told.commands.some((c) => c.at >= since)) throw new Error(`told the phone: ${JSON.stringify(told)}`);
    // Back in view: still not its remote, while it plays on.
    await look();
    if (/Играет на/.test(await playingOn())) throw new Error('made its remote again by itself');
  } finally {
    await page.evaluate(() => window.__wave.sync.elsewhere.leave('drop'));
    await page.evaluate(() => window.__wave.audio.pause());
    await page.evaluate((list) => Promise.all(list.map((n) => window.__wave.sync.disk.remove(n).catch(() => {}))), names);
  }
  const left = await page.evaluate(() => window.__wave.sync.disk.list());
  if (left.some((f) => names.includes(f.name))) throw new Error('files left on Disk');
});

await step('the home network:the PC listens where its file on Disk says; a phone with the key learns what plays at once and its Pause is done here in under a second; a wrong key is refused (removed again)', async () => {
  // The user, 25.10.2026: the remote "as fast as possible" (electron/lan.cjs, src/sync/lan.ts).
  if (!(await page.evaluate(() => window.__wave.sync.useSync.getState().connected))) {
    console.log('       skipped: no YANDEX_DISK_TOKEN');
    return;
  }
  const { WebSocket } = await import('ws');
  const ownId = await page.evaluate(() => window.__wave.sync.deviceSync.device.id);
  const lanName = `lan-${ownId}.json`;
  const phone = { id: `e2ephone${Date.now()}`, platform: 'ios' };
  let ws = null;
  try {
    const info = await page.evaluate(() => window.__wave.sync.elsewhere.listen());
    if (!info?.port || !info.key || info.hosts?.[0] !== '127.0.0.1') throw new Error(`listening: ${JSON.stringify(info && { ...info, key: '…' })}`);
    const file = await page.evaluate((n) => window.__wave.sync.disk.read(n).then((t) => JSON.parse(t)), lanName);
    if (file.port !== info.port || file.key !== info.key || !file.test) throw new Error(`file on Disk: port ${file.port}, test ${file.test}`);

    const connect = (key) => new Promise((resolve) => {
      const s = new WebSocket(`ws://127.0.0.1:${info.port}`);
      const got = [];
      s.on('open', () => s.send(JSON.stringify({ t: 'hello', key, device: phone })));
      s.on('message', (raw) => {
        got.push(JSON.parse(String(raw)));
        if (got.length === 1) resolve({ s, got, welcomed: got[0].t === 'welcome' });
      });
      s.on('close', (code) => resolve({ s, got, closed: code }));
      setTimeout(() => resolve({ s, got }), 4000);
    });
    const wrong = await connect('not the key');
    if (wrong.closed !== 4001) throw new Error(`a wrong key: ${JSON.stringify({ closed: wrong.closed, got: wrong.got })}`);

    const tracks = await page.evaluate(() => window.__wave.api.chart().then((l) => l.filter((t) => t.available !== false).slice(0, 2)));
    await page.evaluate((t) => window.__wave.playTracks(t, 0, 'e2e home network'), tracks);
    await waitPlaying(1.5);
    const link = await connect(info.key);
    if (!link.welcomed) throw new Error(`not welcomed: ${JSON.stringify(link.got)}`);
    ws = link.s;
    const nowFile = (playing) => link.got.find((m) => m.t === 'now' && m.file?.playing === playing && m.file.queue[m.file.index]?.id === tracks[0].id);
    const waitFor = async (what, ms) => {
      for (const until = Date.now() + ms; Date.now() < until; await page.waitForTimeout(50)) if (what()) return what();
      return null;
    };
    if (!(await waitFor(() => nowFile(true), 2000))) throw new Error(`what plays did not come: ${JSON.stringify(link.got.map((m) => m.t))}`);

    const sent = Date.now();
    ws.send(JSON.stringify({ t: 'cmd', to: ownId, command: { id: `${phone.id}.1`, at: sent, fn: 'pause', args: [] } }));
    await page.waitForFunction(() => window.__wave.audio.paused, null, { timeout: 3000 });
    const took = Date.now() - sent;
    const back = await waitFor(() => nowFile(false), 2000);
    const answered = Date.now() - sent;
    if (took > 1000 || !back) throw new Error(`pause in ${took} ms, paused state ${back ? `back in ${answered} ms` : 'never came back'}`);
    console.log(`       paused ${took} ms after the press, the paused state back in ${answered} ms`);
  } finally {
    ws?.close();
    await page.evaluate((n) => window.__wave.sync.disk.remove(n), lanName);
  }
  const left = await page.evaluate(() => window.__wave.sync.disk.list());
  if (left.some((f) => f.name === lanName)) throw new Error('file left on Disk');
});
