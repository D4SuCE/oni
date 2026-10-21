import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'oni-mini-'));
const app = await electron.launch({ args: [root], cwd: root, env: { ...process.env, WAVE_E2E: '1', WAVE_USER_DATA: userData } });
const page = await app.firstWindow();
await page.waitForSelector('.wave-hero', { timeout: 30000 });
const opened = app.waitForEvent('window', { timeout: 8000 }).catch(() => null);
await page.click('[data-testid="mini-button"]');
const mini = await opened;
await page.waitForTimeout(3000);
const wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL().split('/').pop(), visible: w.isVisible(), bounds: w.getBounds(), crashed: w.webContents.isCrashed() })));
console.log(JSON.stringify(wins, null, 1));
if (mini) {
  console.log('mini text:', await mini.locator('body').innerText().catch((e) => 'ERR ' + e.message));
  await mini.screenshot({ path: process.argv[2] + '/mini-empty.png' }).catch((e) => console.log('shot', e.message));
}
await app.close();
fs.rmSync(userData, { recursive: true, force: true });
