// The e2e run's shared part: launches the real Electron app against the real API (muted, an
// isolated user-data dir, wave feedback off: WAVE_E2E=1) and gives the steps their helpers.
// The steps are in tests/e2e/NN-*.mjs, run in order by tests/e2e.mjs.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { steps } from '../step.mjs';

export const root = path.resolve(import.meta.dirname, '..', '..');
export const shots = process.env.WAVE_SHOTS || path.join(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
export const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-'));

export const consoleErrors = [];

export const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData },
});
export const page = await app.firstWindow();
// A file asked for that is known not to be there (07-playback, "will not load") is no error of the app's.
page.on('console', (m) => m.type() === 'error' && !m.location().url?.includes('oni-no-such-file') && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

/** GitHub's machines (e2e.yml) have no graphics card and are slower than the user's PC: the speed
 * checks get this much more room there; on the PC they stay as they are. */
export const SLOW = process.env.CI ? 3 : 1;

/** After a failed step: menus, dialogs and sheets it left open are closed, so the next steps are
 * not blocked by them (one failure took the rest down with it). What plays is left as it is. */
async function recover() {
  for (let i = 0; i < 2; i++) await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300).catch(() => {});
}

/** A step (tests/step.mjs: a failure gets a second try). E2E_ONLY=<regex>: only the steps it
 * matches, after the first (the app starts, signed in). For trying one step again; a finished
 * change still runs them all. */
const run = steps({
  suite: 'e2e',
  filter: true,
  recover,
  onFail: (name) => page.screenshot({ path: path.join(shots, `FAIL-${name.replace(/\W+/g, '_')}.png`) }),
});
let first = true;
export function step(name, fn) {
  const always = first;
  first = false;
  return run.step(name, fn, { always });
}

export const shot = (name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
export const player = () => page.evaluate(() => {
  const s = window.__wave.usePlayer.getState();
  const a = window.__wave.audio;
  return { title: s.queue[s.index]?.title, index: s.index, queue: s.queue.length, source: s.source?.kind, playing: !a.paused, time: a.currentTime, stats: s.waveStats, error: s.error };
});
export async function waitPlaying(minTime = 1.5, timeout = 30000) {
  await page.waitForFunction((t) => !window.__wave.audio.paused && window.__wave.audio.currentTime > t, minTime, { timeout });
}

const startedAt = Date.now();

/** What the run's Oni (a new device each run) left in Oni's folder on the test Disk: its own files
 * ("what plays", commands, its device file) and the rooms of "Together" made during the run. The user,
 * 30.10.2026: the Disk filled with "e2e phone" players and test rooms. */
async function sweepDisk() {
  const id = await page.evaluate(async () => {
    const { sync } = window.__wave;
    if (!sync.useSync.getState().connected) return null;
    const own = sync.deviceSync.device.id;
    for (const f of await sync.disk.list()) if (f.name.includes(own)) await sync.disk.remove(f.name).catch(() => {});
    return own;
  }).catch(() => null);
  const token = process.env.YANDEX_DISK_TOKEN;
  if (!id || !token) return;
  const api = 'https://cloud-api.yandex.net/v1/disk/resources';
  const headers = { Authorization: `OAuth ${token}` };
  const r = await fetch(`${api}?path=${encodeURIComponent('app:/together')}&limit=1000`, { headers }).catch(() => null);
  const items = r?.ok ? ((await r.json())._embedded?.items ?? []) : [];
  for (const i of items)
    if (i.type === 'file' && Date.parse(i.created ?? i.modified) >= startedAt - 60_000)
      await fetch(`${api}?path=${encodeURIComponent(`app:/together/${i.name}`)}&permanently=true`, { method: 'DELETE', headers }).catch(() => {});
}

/** The end of the run: the app closed, its data dir removed, the count; a failure fails the run. */
export async function finish() {
  await page.evaluate(() => window.__wave.audio.pause()).catch(() => {});
  await sweepDisk();
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`Screenshots: ${shots}`);
  if (run.summary()) process.exit(1);
}
