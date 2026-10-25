// e2e: start (part of tests/e2e.mjs; run the whole with npm run test:e2e).
import { page, step, shot } from './harness.mjs';

await step('app starts and logs in with token', async () => {
  await page.waitForSelector('[data-testid="nav-home"]', { timeout: 30000 });
  await page.waitForSelector('.wave-hero');
  await page.waitForTimeout(2500); // let shelves & covers load
  await shot('01-home');
});

await step("the data lives in IndexedDB; what an older Oni left in localStorage moves there, and localStorage gets its room back", async () => {
  // The iPhone's localStorage (about 5 MB) was full: a night of plays was never kept, and "Made for you"
  // was made anew on every opening (the user, 25.10.2026).
  if ((await page.evaluate(() => window.__wave.storage.kind)) !== 'indexeddb') throw new Error('not in IndexedDB');
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('ui.')));
  if (left.length) throw new Error(`still in localStorage: ${left.join(', ')}`);
  await page.evaluate(() => localStorage.setItem('e2e.older', 'kept'));
  await page.reload();
  await page.waitForSelector('[data-testid="nav-home"]', { timeout: 30000 });
  const moved = await page.evaluate(() => ({ here: window.__wave.storage.getItem('e2e.older'), local: localStorage.getItem('e2e.older') }));
  await page.evaluate(() => window.__wave.storage.removeItem('e2e.older'));
  if (moved.here !== 'kept' || moved.local !== null) throw new Error(`moved: ${JSON.stringify(moved)}`);
  await page.waitForSelector('.wave-hero');
});

await step('the oni mask sits in the middle of the logo', async () => {
  // The mask's axis is the nose line where the white half meets the black one: per row of the
  // nose, the sharpest light-to-dark step near the middle; its median must be the image centre.
  const { seam, width } = await page.evaluate(async () => {
    const url = getComputedStyle(document.querySelector('.logo-mark')).backgroundImage.slice(5, -2);
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const c = document.createElement('canvas');
    c.width = c.height = w;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, w).data;
    const lum = (x, y) => { const i = (y * w + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
    const step = Math.max(1, Math.round(w / 170));
    const seams = [];
    for (let y = Math.round(w * 0.51); y < w * 0.74; y++) {
      let best = 0, at = -1;
      for (let x = Math.round(w * 0.37); x < w * 0.63 - step; x++) {
        const g = lum(x, y) - lum(x + step, y);
        if (g > best) [best, at] = [g, x + step / 2];
      }
      if (best > 60) seams.push(at);
    }
    seams.sort((a, b) => a - b);
    return { seam: seams[seams.length >> 1], width: w };
  });
  if (!(Math.abs(seam - width / 2) <= width * 0.015)) throw new Error(`mask axis at ${seam} of ${width}`);
});

await step('button labels sit in the middle of the button', async () => {
  // Optical middle of a label: halfway between the x-height and cap-height middles above the
  // baseline. The baseline comes from an empty inline-block probe, the heights from the font itself.
  const off = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return [...document.querySelectorAll('.btn')].flatMap((btn) => {
      const text = [...btn.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const box = btn.getBoundingClientRect();
      if (!text || !box.height) return [];
      // The button is a flex box: the probe shares a wrapper with the text to sit on its line.
      const wrap = document.createElement('span');
      const probe = document.createElement('span');
      probe.style.display = 'inline-block';
      text.replaceWith(wrap);
      wrap.append(probe, text);
      const baseline = probe.getBoundingClientRect().bottom;
      wrap.replaceWith(text);
      ctx.font = getComputedStyle(btn).font;
      const cap = ctx.measureText('H').actualBoundingBoxAscent;
      const x = ctx.measureText('x').actualBoundingBoxAscent;
      const middle = baseline - (cap + x) / 4;
      return [{ label: text.textContent.trim(), off: +(middle - (box.top + box.height / 2)).toFixed(2) }];
    });
  });
  const bad = off.filter((b) => Math.abs(b.off) > 0.6);
  if (!off.length || bad.length) throw new Error(`${off.length} buttons, off-centre (px, + is low): ${JSON.stringify(bad)}`);
});
