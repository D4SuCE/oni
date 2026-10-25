// The e2e run's shared part: launches the real Electron app against the real API (muted, an
// isolated user-data dir, wave feedback off: WAVE_E2E=1) and gives the steps their helpers.
// The steps are in tests/e2e/NN-*.mjs, run in order by tests/e2e.mjs.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..', '..');
export const shots = process.env.WAVE_SHOTS || path.join(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
export const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-'));

let passed = 0;
let failed = 0;
export const consoleErrors = [];

export const app = await electron.launch({
  args: [root],
  cwd: root,
  env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData },
});
export const page = await app.firstWindow();
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

/** GitHub's machines (e2e.yml) have no graphics card and are slower than the user's PC: the speed
 * checks get this much more room there; on the PC they stay as they are. */
export const SLOW = process.env.CI ? 3 : 1;

/** E2E_ONLY=<regex>: only the steps it matches, after the first (the app starts, signed in). For
 * trying one step again; a finished change still runs them all. */
const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null;
let first = true;

/** A broken connection to Yandex or Disk, not the app: the step is worth one more try. */
const NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|Yandex Disk: no answer|net::ERR_/i;

/** After a failed step: menus, dialogs and sheets it left open are closed, so the next steps are
 * not blocked by them (one failure took the rest down with it). What plays is left as it is. */
async function recover() {
  for (let i = 0; i < 2; i++) await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300).catch(() => {});
}

export async function step(name, fn) {
  if (only && !first && !only.test(name)) return;
  first = false;
  for (let attempt = 1; ; attempt++) {
    try {
      await fn();
      passed++;
      console.log(`  ok   ${name}${attempt > 1 ? ' (on a second try: the network broke)' : ''}`);
      return;
    } catch (e) {
      const why = e?.message || String(e);
      if (attempt === 1 && NETWORK.test(why)) {
        console.log(`  ..   ${name}: the network broke (${why.split('\n')[0].slice(0, 120)}), trying again`);
        await recover();
        await page.waitForTimeout(5000);
        continue;
      }
      failed++;
      console.log(`  FAIL ${name}: ${why}`);
      await page.screenshot({ path: path.join(shots, `FAIL-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
      await recover();
      return;
    }
  }
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

/** The end of the run: the app closed, its data dir removed, the count; a failure fails the run. */
export async function finish() {
  await page.evaluate(() => window.__wave.audio.pause()).catch(() => {});
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${shots}`);
  if (failed) process.exit(1);
}
