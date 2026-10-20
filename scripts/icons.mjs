// Regenerates every app icon from the master artwork design/oni-icon-1024.png (any PNG or
// SVG works): build/icon.png and build/icon.ico (installer and exe), electron/assets/icon.png
// (window), electron/assets/tray.ico and src/assets/oni-mark.png (logo in the app).
// Renders with the project's Electron, so it needs nothing else installed.
// Run: npm run icons
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const master = path.join(root, 'design', process.argv[2] || 'oni-icon-1024.png');
const mime = master.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
const source = `data:${mime};base64,${fs.readFileSync(master).toString('base64')}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-icons-'));
const main = path.join(tmp, 'main.cjs');
fs.writeFileSync(
  main,
  `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false }).loadURL('about:blank'));`,
);

const app = await electron.launch({ args: [main] });
const page = await app.firstWindow();

/** PNG bytes of the artwork drawn at size × size (the browser downscales it smoothly). */
async function png(size) {
  const big = Math.min(size * 4, 1024);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">
       <img src="${source}" width="${big}" height="${big}"
            style="width:${size}px;height:${size}px;display:block">
     </body></html>`,
  );
  await page.waitForTimeout(150);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An .ico holding PNG images (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((x) => x.data)]);
}

/** One page draws all sizes, so render them one after another. */
async function render(sizes) {
  const images = [];
  for (const size of sizes) images.push({ size, data: await png(size) });
  return images;
}

const out = (...p) => path.join(root, ...p);
fs.writeFileSync(out('build', 'icon.png'), await png(512));
fs.writeFileSync(out('electron', 'assets', 'icon.png'), await png(256));
fs.writeFileSync(out('build', 'icon.ico'), ico(await render([16, 24, 32, 48, 64, 128, 256])));
fs.writeFileSync(out('electron', 'assets', 'tray.ico'), ico(await render([16, 20, 24, 32, 48, 64])));
fs.writeFileSync(out('src', 'assets', 'oni-mark.png'), await png(128));

await app.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('icons written: build/icon.png, build/icon.ico, electron/assets/icon.png, electron/assets/tray.ico, src/assets/oni-mark.png');
