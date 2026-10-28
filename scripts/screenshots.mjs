// Showcase screenshots for the releases page (D4SuCE/oni-releases): drives the real app
// like e2e.mjs (muted, isolated profile, no wave feedback) and saves JPEGs. The account
// name is taken out of the greeting, and no screen with the account on it is shot.
// Run: node scripts/screenshots.mjs [out dir]   (needs YANDEX_MUSIC_TOKEN and a fresh `vite build`)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'release', 'showcase'));
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'oni-shots-'));

const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData } });
const page = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 60, y: 40, width: 1440, height: 900 }));
await page.waitForSelector('.wave-hero', { timeout: 30000 });

const anonymize = () =>
  page.evaluate(() => {
    const g = document.querySelector('.greeting');
    if (g) g.textContent = g.textContent.split(',')[0];
  });
const shot = async (name, target = page) => {
  await anonymize();
  // No hover highlight in the frame.
  await target.mouse.move(0, 0);
  await target.waitForTimeout(300);
  await target.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 90 });
  console.log(`  ${name}.jpg`);
};
const settle = (ms = 2500) => page.waitForTimeout(ms);
const closeFullscreen = async () => {
  if (await page.locator('.np-stage').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
};

// Home with the "For you" shelf filled in, all of it ("Собираю подборки…" gone; ~25 s).
await page.waitForSelector('[data-testid="mix-card"]', { timeout: 60000 });
await page.waitForFunction(() => !document.body.innerText.includes('Собираю'), null, { timeout: 90000 }).catch(() => {});
await settle();
await shot('home');

// Wave settings.
await page.click('[data-testid="wave-tune"]');
await page.waitForSelector('.drawer');
await settle(800);
await shot('wave-tuning');
await page.keyboard.press('Escape');
await page.mouse.click(200, 400);
await page.waitForSelector('.drawer', { state: 'detached' });

// Now playing, from the wave.
await page.click('[data-testid="nav-home"]');
await page.click('[data-testid="wave-play"]');
await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.audio.currentTime > 1, null, { timeout: 30000 });
await page.click('.pb-cover');
// a track with words in time, for the lyrics (a few along the wave)
for (let i = 0; i < 10; i++) {
  await page.click('[data-testid="tab-lyrics"]');
  if (await page.waitForSelector('.np-side .lyric', { timeout: 12000 }).catch(() => null)) break;
  await page.locator('.np-stage [data-testid="next"]').click();
  await page.waitForFunction(() => !window.__wave.audio.paused && window.__wave.audio.currentTime > 1, null, { timeout: 30000 });
}
await settle(3000);
// The words in time, beside the cover.
await shot('lyrics');
await page.locator('.np-side .tab').first().click();
await settle(1500);
await shot('now-playing');
await closeFullscreen();

// A mix, with the wave playing below; the first card is "Discover weekly".
await page.click('[data-testid="nav-home"]');
await page.locator('[data-testid="mix-card"]').first().click();
await page.waitForSelector('.track-row', { timeout: 30000 });
await settle();
await shot('mix');

// Sound settings with the equalizer on, over the mix.
await page.click('[data-testid="sound-button"]');
await page.waitForSelector('[data-testid="sound-panel"]');
await page.locator('[data-testid="eq-toggle"]').check();
await page.click('[data-testid="eq-preset"]');
await page.click('[data-testid="preset-bass"]');
await settle(800);
await shot('sound');
await page.keyboard.press('Escape');
await page.mouse.click(700, 300);
await page.waitForTimeout(500);

// A smart playlist (the first: liked this month).
await page.click('[data-testid="nav-home"]');
await page.locator('[data-testid="smart-playlists"] [data-testid="mix-card"], [data-testid="smart-playlists"] .card').first().click();
await page.waitForSelector('.track-row', { timeout: 30000 });
await settle();
await shot('smart');

// History: what the account played, on all devices.
await page.click('[data-testid="nav-history"]');
await page.click('[data-testid="history-yandex"]');
await page.waitForSelector('.history-group .track-row', { timeout: 30000 });
await settle();
await shot('history');

// The artist of the playing track.
await page.evaluate(() => {
  const s = window.__wave.usePlayer.getState();
  window.__wave.navigate({ name: 'artist', id: s.queue[s.index].artists[0].id });
});
await page.waitForSelector('.page-title, h1', { timeout: 20000 });
await settle();
await shot('artist');

// Mini player, shot on its own.
const opened = app.waitForEvent('window');
await page.click('[data-testid="mini-button"]');
const mini = await opened;
await mini.waitForSelector('[data-testid="mini-toggle"]');
await mini.waitForTimeout(1500);
await shot('mini', mini);
await mini.click('[data-testid="mini-expand"]', { noWaitAfter: true }).catch(() => {});
await page.waitForTimeout(1000);

await app.close();
fs.rmSync(userData, { recursive: true, force: true });
console.log(`\nsaved to ${out}`);
