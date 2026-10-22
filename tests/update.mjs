// Auto-update test: the app polls a local feed (a stand-in for GitHub Releases), downloads
// a newer "version" and offers it in Settings; also the up-to-date and offline cases.
// The downloaded file is a dummy and is never run. Needs YANDEX_MUSIC_TOKEN like e2e.mjs.
// Run: npm run test:e2e (runs after desktop.mjs)
import { _electron as electron } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const { version: current } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-update-'));
const config = path.join(userData, 'app-update.yml');
const CACHE_DIR = 'oni-updater-test';
let passed = 0;
let failed = 0;

// ------------------------------------------------------------------ the feed

const installer = crypto.randomBytes(64 * 1024);
const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
let feedVersion = '9.9.9';
const latestYml = () =>
  [
    `version: ${feedVersion}`,
    'files:',
    `  - url: Oni-Setup-${feedVersion}.exe`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: Oni-Setup-${feedVersion}.exe`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-10-21T00:00:00.000Z'",
  ].join('\n');

const server = http.createServer((req, res) => {
  const file = decodeURIComponent(req.url.split('?')[0].slice(1));
  if (file === 'latest.yml') return res.end(latestYml());
  // A moment late, so the download ends with the window up and its message can be seen.
  if (file === `Oni-Setup-${feedVersion}.exe`) return void setTimeout(() => res.end(installer), 4000);
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feed = `http://127.0.0.1:${server.address().port}/`;

const writeConfig = (url) => fs.writeFileSync(config, `provider: generic\nurl: ${url}\nupdaterCacheDirName: ${CACHE_DIR}\n`);

// ------------------------------------------------------------------- helpers

async function launch() {
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData, ONI_UPDATE_CONFIG: config },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.wave-hero', { timeout: 30000 });
  await page.locator('.sidebar > .nav-item', { hasText: 'Настройки' }).click();
  return { app, page };
}

const waitStatus = (page, status, timeout = 30000) => page.waitForSelector(`[data-testid="update"][data-status="${status}"]`, { timeout });

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

// --------------------------------------------------------------------- steps

writeConfig(feed);
let { app, page } = await launch();

await step('a newer version downloads, Settings and the sidebar offer to install it', async () => {
  await waitStatus(page, 'ready');
  // The "ready" message is a toast that goes away by itself (it was put up past the toast timer
  // and stayed for good).
  await page.waitForSelector('.toast:has-text("9.9.9")', { timeout: 10000 });
  await page.waitForSelector('.toast:has-text("9.9.9")', { state: 'detached', timeout: 6000 });
  const text = await page.locator('[data-testid="update"]').innerText();
  if (!text.includes('9.9.9')) throw new Error(`status text: ${text}`);
  await page.waitForSelector('[data-testid="update-install"]', { timeout: 2000 });
  await page.waitForSelector('[data-testid="update-dot"]', { timeout: 2000 });
  await page.locator('[data-testid="update"]').scrollIntoViewIfNeeded();
  fs.mkdirSync(path.join(root, 'tests/screenshots'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'tests/screenshots/update-ready.png') });
});

await app.close();
feedVersion = current;
({ app, page } = await launch());

await step('the same version as installed: "latest", no dot', async () => {
  await waitStatus(page, 'latest');
  if (await page.locator('[data-testid="update-dot"]').count()) throw new Error('dot shown');
});

await app.close();
writeConfig('http://127.0.0.1:9/');
({ app, page } = await launch());

await step('feed unreachable: an error in Settings, checking again stays possible', async () => {
  await waitStatus(page, 'error');
  if (await page.locator('[data-testid="update-check"]').isDisabled()) throw new Error('check button disabled');
  await page.click('[data-testid="update-check"]');
  await waitStatus(page, 'error');
  await page.waitForSelector('.wave-hero, .page', { timeout: 2000 });
});

await app.close().catch(() => {});
server.close();
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(path.join(process.env.LOCALAPPDATA || os.tmpdir(), CACHE_DIR), { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
