// Downloads and the offline mode, in the real app: a track downloaded from the track menu is
// stored encrypted and plays from the file; started with no network (the main process fails
// every request, WAVE_E2E_OFFLINE=1), the app opens on the downloads and still plays them; when
// the network is back, it goes online again. Needs YANDEX_MUSIC_TOKEN like e2e.mjs.
// Run: npm run test:e2e (runs after login.mjs)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-offline-'));
const offlineDir = path.join(userData, 'offline');
const shots = path.join(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });
let passed = 0;
let failed = 0;

async function launch(offline = false) {
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData, ...(offline ? { WAVE_E2E_OFFLINE: '1' } : {}) },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(offline ? '[data-testid="offline-banner"]' : '.wave-hero', { timeout: 30000 });
  return { app, page };
}

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.message || e}`);
  }
}

async function playingFromFile(page) {
  await page.waitForFunction(() => window.__wave.audio.src.startsWith('blob:') && !window.__wave.audio.paused && window.__wave.audio.currentTime > 1, null, { timeout: 20000 });
  // The bar moves with it.
  await page.waitForFunction(() => document.querySelector('.playerbar .time')?.textContent !== '0:00', null, { timeout: 5000 });
}

let { app, page } = await launch();
let title = '';

await step('download a track: encrypted on disk, then it plays from the file', async () => {
  await page.waitForSelector('[data-testid="mix-card"]', { timeout: 60000 });
  await page.locator('[data-testid="mix-card"]').first().click();
  const row = page.locator('.track-row').first();
  await row.waitFor();
  title = await row.locator('.tr-title').innerText();
  await row.click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Скачать' }).click();
  await row.locator('[data-testid="saved-mark"]').waitFor({ timeout: 60000 });

  const files = fs.readdirSync(offlineDir);
  if (files.length !== 1 || !files[0].endsWith('.oni')) throw new Error(`files: ${files}`);
  const head = fs.readFileSync(path.join(offlineDir, files[0])).subarray(0, 4096);
  // Not an mp3 anyone can open: no ID3 tag, no MPEG frame sync at the start.
  if (head.includes(Buffer.from('ID3')) || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) throw new Error('the file on disk is plain audio');

  await row.locator('.tr-play').click();
  await playingFromFile(page);
  await shot(page, '20-downloaded-mark');
});

await step('the downloads page lists it', async () => {
  await page.click('[data-testid="nav-downloads"]');
  await page.waitForSelector('.track-row');
  const titles = await page.locator('.track-row .tr-title').allInnerTexts();
  if (titles.length !== 1 || titles[0] !== title) throw new Error(`downloads: ${titles}`);
  await shot(page, '21-downloads');
});

await app.close();
({ app, page } = await launch(true));

await step('no network: the app starts on the downloads and plays them', async () => {
  await page.waitForSelector('.track-row', { timeout: 10000 });
  const titles = await page.locator('.track-row .tr-title').allInnerTexts();
  if (titles[0] !== title) throw new Error(`downloads offline: ${titles}`);
  await page.click('[data-testid="downloads-play"]');
  await playingFromFile(page);
  await shot(page, '22-offline');
});

await step('the network is back: the app goes online again', async () => {
  await page.evaluate(() => {
    window.wave.setNetworkForTest(true);
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForSelector('[data-testid="offline-banner"]', { state: 'detached', timeout: 15000 });
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('.wave-hero', { timeout: 15000 });
});

await step('remove all from Settings frees the space', async () => {
  await page.click('[data-testid="nav-settings"]');
  await page.click('[data-testid="downloads-remove-all"]');
  await page.locator('.dialog button.danger').click();
  await page.waitForSelector('[data-testid="downloads-remove-all"]', { state: 'detached', timeout: 5000 });
  if (fs.readdirSync(offlineDir).length) throw new Error('files left');
});

await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
