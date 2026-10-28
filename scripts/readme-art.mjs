// The releases page's pictures (D4SuCE/oni-releases, README): a banner in Oni's look, section titles,
// the iPhone's screens in a phone's frame (Pro Max, Dynamic Island), the PC's in a thin frame — drawn
// by a browser (Edge) from Oni's own art and fonts.
// Run: node scripts/readme-art.mjs <PC shots dir> <iPhone shots dir> <out dir>
//   PC shots — `npm run screenshots` (JPEGs); iPhone shots — the `screens` workflow's artifact (shot-*.png).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const [pcDir, phoneDir, outArg] = process.argv.slice(2);
if (!pcDir || !phoneDir || !outArg) throw new Error('node scripts/readme-art.mjs <PC shots dir> <iPhone shots dir> <out dir>');
const out = path.resolve(outArg);
fs.mkdirSync(out, { recursive: true });
const url = (p) => pathToFileURL(path.resolve(p)).href;
const asset = (name) => url(path.join(root, 'src/assets', name));
const font = (pkg, file) => url(path.join(root, 'node_modules/@fontsource', pkg, 'files', file));

const css = `
@font-face { font-family: Montserrat; font-weight: 300; src: url(${font('montserrat', 'montserrat-latin-300-normal.woff2')}); }
@font-face { font-family: Montserrat; font-weight: 300; src: url(${font('montserrat', 'montserrat-cyrillic-300-normal.woff2')}); unicode-range: U+0400-045F; }
@font-face { font-family: Montserrat; font-weight: 500; src: url(${font('montserrat', 'montserrat-latin-500-normal.woff2')}); }
@font-face { font-family: Montserrat; font-weight: 500; src: url(${font('montserrat', 'montserrat-cyrillic-500-normal.woff2')}); unicode-range: U+0400-045F; }
@font-face { font-family: Zen; font-weight: 500; src: url(${font('zen-kaku-gothic-new', 'zen-kaku-gothic-new-latin-500-normal.woff2')}); }
@font-face { font-family: Zen; font-weight: 500; src: url(${font('zen-kaku-gothic-new', 'zen-kaku-gothic-new-cyrillic-500-normal.woff2')}); unicode-range: U+0400-045F; }
@font-face { font-family: Zen; font-weight: 700; src: url(${font('zen-kaku-gothic-new', 'zen-kaku-gothic-new-latin-700-normal.woff2')}); }
@font-face { font-family: Zen; font-weight: 700; src: url(${font('zen-kaku-gothic-new', 'zen-kaku-gothic-new-cyrillic-700-normal.woff2')}); unicode-range: U+0400-045F; }
@font-face { font-family: Brush; src: url(${asset('brush.woff2')}); }
:root { --bg: #090909; --red: #d9272e; --red-deep: #8e171b; --gold: #c79a54; --text: #f2eee8; --text-2: #a7a3a0; --line: #49403d; }
* { box-sizing: border-box; margin: 0; }
html, body { background: var(--bg); color: var(--text); font-family: Zen, sans-serif; }
/* the scene behind: the misty mountains and the red moon, darkened */
.scene { position: relative; overflow: hidden; background: linear-gradient(180deg, rgba(9,9,9,.55), rgba(9,9,9,.82)), url(${asset('bg-misty.jpg')}) 50% 30% / cover; }
.scene::after { content: ''; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 160px 40px rgba(9,9,9,.9); }
.kicker { font-family: Montserrat; font-weight: 500; font-size: 15px; letter-spacing: .42em; text-transform: uppercase; color: var(--gold); }
.stroke { width: 64px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--red), var(--red-deep)); }

/* the phone: the screen (its corners cut by the simulator) in a dark titanium band */
.phone { position: relative; width: var(--w); aspect-ratio: 1320 / 2868; padding: calc(var(--w) * .032); border-radius: calc(var(--w) * .165);
  background: linear-gradient(145deg, #3b3533, #171413 40%, #26211f 70%, #3a3431);
  box-shadow: 0 0 0 1.5px #5c524d, inset 0 0 0 2px #0b0a0a, 0 50px 90px -20px rgba(0,0,0,.85), 0 0 120px -30px rgba(217,39,46,.35); }
.phone img { display: block; width: 100%; height: 100%; border-radius: calc(var(--w) * .135); background: #000; }
.phone::before, .phone::after { content: ''; position: absolute; width: 4px; border-radius: 2px; background: linear-gradient(90deg, #4a423f, #2a2523); }
.phone::before { left: -4px; top: 21%; height: 7%; box-shadow: 0 calc(var(--w) * .2) 0 #3a3331; }
.phone::after { right: -4px; top: 27%; height: 11%; }
`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ deviceScaleFactor: 2 });
/** `height` 0: as tall as what is drawn. */
async function draw(name, html, width, height, type = 'jpeg') {
  await page.setViewportSize({ width, height: height || 100 });
  // a file, not setContent: a page from nowhere may not load the local pictures and fonts
  const tmp = path.join(out, '_draw.html');
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>${css}</style>${html}`);
  await page.goto(url(tmp), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const file = path.join(out, `${name}.${type === 'jpeg' ? 'jpg' : 'png'}`);
  await page.screenshot({ path: file, type, fullPage: !height, ...(type === 'jpeg' ? { quality: 88 } : {}) });
  console.log(`  ${path.basename(file)} ${Math.round(fs.statSync(file).size / 1024)} KB`);
}

// The banner: the oni mask on the right, the name on the left.
await draw(
  'banner',
  `<div class="scene" style="width:1280px;height:440px">
    <div style="position:absolute;right:40px;top:-10px;width:520px;height:460px;background:url(${asset('hero-mask.jpg')}) 50% 35% / cover;
      -webkit-mask-image:radial-gradient(closest-side, #000 55%, transparent 100%);mask-image:radial-gradient(closest-side, #000 55%, transparent 100%)"></div>
    <div style="position:absolute;right:56px;top:46px;display:flex;flex-direction:column;align-items:center;gap:14px;z-index:2">
      <span style="font-family:Brush;font-size:92px;line-height:1;color:var(--red);text-shadow:0 0 30px rgba(217,39,46,.45)">鬼</span>
      <span style="font-family:Brush;font-size:30px;writing-mode:vertical-rl;letter-spacing:.12em;color:var(--text)">音楽で生きる</span>
    </div>
    <div style="position:absolute;left:84px;top:96px;z-index:2">
      <div class="kicker">Яндекс Музыка · по-своему</div>
      <div style="font-family:Montserrat;font-weight:300;font-size:132px;letter-spacing:.32em;line-height:1.1;margin:18px 0 8px -6px">ONI</div>
      <div class="stroke"></div>
      <div style="font-size:26px;font-weight:500;margin-top:22px">Неофициальный клиент для Windows и iPhone</div>
      <div style="font-size:18px;color:var(--text-2);margin-top:10px">«Моя волна» без повторов · подборки в духе Spotify · японский стиль</div>
    </div>
  </div>`,
  1280,
  440,
);

// Section titles, as the app's own: a brush kanji, the vermilion stroke, the title in wide letters.
const sections = [
  ['features', '機能', 'Что умеет'],
  ['iphone', '携帯', 'iPhone'],
  ['devices', '二台', 'Два устройства'],
  ['install', '導入', 'Установка'],
  ['updates', '更新', 'Обновления'],
  ['faq', '問答', 'Вопросы'],
];
for (const [name, kanji, title] of sections)
  await draw(
    `h-${name}`,
    `<div style="width:1280px;height:96px;display:flex;align-items:center;gap:26px;padding:0 8px;background:linear-gradient(90deg, #171514, #090909 70%)">
      <span style="font-family:Brush;font-size:54px;line-height:1;color:var(--red);width:118px;text-align:center">${kanji}</span>
      <span style="width:4px;height:34px;border-radius:2px;background:linear-gradient(180deg, #ff4a50, var(--red) 70%, var(--red-deep))"></span>
      <span style="font-family:Montserrat;font-weight:500;font-size:28px;letter-spacing:.32em;text-transform:uppercase">${title}</span>
      <span style="flex:1;height:1px;margin-left:12px;background:linear-gradient(90deg, var(--line), transparent)"></span>
    </div>`,
    1280,
    96,
  );

// The iPhone: three screens side by side, the middle one ahead.
// Oni's own picture of its window (src/ios-screens.ts), the status bar and the Dynamic Island over it
// (design/iphone-statusbar.png, cut from a Pro Max's screen: 9:41, Wi-Fi, a full battery).
const phone = (name, w) =>
  `<div class="phone" style="--w:${w}px"><div style="position:relative;height:100%">
    <img src="${url(path.join(phoneDir, `shot-${name}.png`))}">
    <img src="${url(path.join(root, 'design/iphone-statusbar.png'))}" style="position:absolute;left:0;top:0;width:100%;height:auto;border-radius:0;background:none">
  </div></div>`;
const trio = (a, b, c, title) =>
  `<div class="scene" style="width:1280px;height:900px;display:flex;align-items:center;justify-content:center;gap:54px">
    <div style="position:absolute;left:0;right:0;top:34px;text-align:center;z-index:2" class="kicker">${title}</div>
    <div style="margin-top:70px;z-index:1">${phone(a, 300)}</div>
    <div style="margin-top:20px;z-index:1">${phone(b, 330)}</div>
    <div style="margin-top:70px;z-index:1">${phone(c, 300)}</div>
  </div>`;
await draw('iphone-main', trio('home', 'now-playing', 'lyrics', 'Главная · Сейчас играет · Текст в такт'), 1280, 900);
await draw('iphone-more', trio('mix', 'collection', 'sound', 'Подборки · Коллекция · Звук'), 1280, 900);

// The PC's screens: a thin frame and rounded corners on Oni's black.
for (const name of fs.readdirSync(pcDir).filter((f) => f.endsWith('.jpg')).map((f) => f.replace(/\.jpg$/, ''))) {
  const src = url(path.join(pcDir, `${name}.jpg`));
  // the mini player at its own size, the window ones at 1440 wide
  const w = name === 'mini' ? 560 : 1440;
  await draw(
    `pc-${name}`,
    `<div style="width:${w + 48}px;padding:24px;background:var(--bg)">
      <img src="${src}" style="display:block;width:${w}px;border-radius:14px;box-shadow:0 0 0 1px var(--line), 0 24px 60px -18px rgba(0,0,0,.9)">
    </div>`,
    w + 48,
    0,
  );
}

await browser.close();
fs.rmSync(path.join(out, '_draw.html'), { force: true });
console.log(`\nsaved to ${out}`);
