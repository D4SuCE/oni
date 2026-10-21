// Sign-in test: the login screen shows without a token, and the Yandex sign-in window opens in
// the interface language rather than the system's. Nothing is typed in; the real account is untouched.
// Run: npm run test:e2e (runs after update.mjs)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
let passed = 0;
let failed = 0;

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

/** Opens the Yandex sign-in window with the interface in `lang` and returns its text. */
async function signInPage(lang) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-login-'));
  const env = { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData };
  delete env.YANDEX_MUSIC_TOKEN;
  const app = await electron.launch({ args: [root], cwd: root, env });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.login-card', { timeout: 30000 });
    await page.evaluate((l) => localStorage.setItem('ui.lang', l), lang);
    await page.reload();
    await page.waitForSelector('.login-card');
    const opened = app.waitForEvent('window');
    await page.click('.login-card .btn.primary');
    const yandex = await opened;
    await yandex.waitForFunction(() => document.body?.innerText.trim().length > 40, null, { timeout: 30000 });
    return await yandex.locator('body').innerText();
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

await step('Yandex sign-in follows a Russian interface', async () => {
  const text = await signInPage('ru');
  if (!/Введите|Войти|номер/i.test(text)) throw new Error(`page: ${text.slice(0, 120)}`);
});

await step('Yandex sign-in follows an English interface', async () => {
  const text = await signInPage('en');
  if (!/Enter|Log in|phone/i.test(text) || /Введите/.test(text)) throw new Error(`page: ${text.slice(0, 120)}`);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
