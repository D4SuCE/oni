// The watch on Yandex Music (asked by the user, 23.10.2026): Yandex publishes no changelog of its
// API, and on 21.10 it quietly stopped counting /play-audio. Once a day (scripts/ym-watch.ps1, from
// the Windows Task Scheduler, or GitHub's ym-watch.yml) this looks whether a new official desktop app is out; if so it takes
// a fingerprint of what the app asks of the API (endpoints, the fields of a play, the equalizer)
// and compares it with the last one. It also runs the API tests on the real account (test:api),
// which catch a change on Yandex's side with no new app at all.
//
//   node scripts/ym-watch.mjs [--force] [--no-canary] [--baseline <app dir>]
//
// Exit: 0 nothing new · 3 a new app, nothing in the fingerprint changed · 4 the fingerprint
// changed · 5 the API tests fail. On 4 and 5 the runner (ym-watch.ps1) sends a notification.
// Everything lives in %LOCALAPPDATA%/oni-watch: the installers, the snapshot, the report.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import asar from '@electron/asar';

const FEED = 'https://desktop.app.music.yandex.net/stable/';
// ONI_WATCH_DIR: where GitHub's daily run (ym-watch.yml) keeps it, the checkout of the ym-watch branch.
const DATA = process.env.ONI_WATCH_DIR || path.join(process.env.LOCALAPPDATA || path.join(process.env.HOME || '.', '.local'), 'oni-watch');
const SNAPSHOT = path.join(DATA, 'snapshot.json');
const REPORT = path.join(DATA, 'report.md');
const NEXT = path.join(DATA, 'next-snapshot.json');
const SEVEN_ZIP = ['C:/Program Files/7-Zip/7z.exe', 'C:/Windows/System32/7z.exe'].find((p) => fs.existsSync(p)) || '7z';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

fs.mkdirSync(DATA, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);

/** Every .js file under a folder, read whole. */
function* scripts(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') yield* scripts(p);
    } else if (e.name.endsWith('.js')) yield fs.readFileSync(p, 'utf8');
  }
}

const uniq = (xs) => [...new Set(xs)].sort();
const all = (text, re) => [...text.matchAll(re)];

/** What the app asks of the API, as far as Oni cares (see src/api/yandex.ts, src/player/eqCurve.ts). */
export function fingerprint(appDir) {
  let version = '';
  try {
    version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  } catch {}
  const endpoints = [];
  const strings = [];
  const playFields = [];
  const seeds = [];
  const eq = {};
  for (const js of scripts(appDir)) {
    for (const m of all(js, /httpClient\.(get|post|put|delete|patch)\((`[^`]{1,160}`|"[^"]{1,160}")/g)) {
      endpoints.push(`${m[1].toUpperCase()} ${m[2].slice(1, -1).replace(/\$\{[^}]*\}/g, '{}')}`);
    }
    for (const m of all(js, /"((?:rotor|plays|play-audio|music-history|ynison|landing|users)[a-z0-9/_-]*)"/g)) strings.push(m[1]);
    for (const m of all(js, /\.playData\.([a-zA-Z]+)=/g)) playFields.push(m[1]);
    for (const m of all(js, /"(setting[A-Z][a-zA-Z]+)"/g)) seeds.push(m[1]);
    const q = js.match(/createBiquadFilter\(\);?[^;]{0,200}?\.Q\.value=([\d.]+)/);
    if (q) eq.q = Number(q[1]);
    const keys = js.match(/frequencies:\[((?:\{key:[\d.e]+,value:[-\d.e]+\},?)+)\]/);
    if (keys) eq.bands = all(keys[1], /key:([\d.e]+)/g).map((k) => Number(k[1]));
    const pre = js.match(/minValue:([\d.]+),maxValue:([\d.]+),value:[\w.$]+\.currentPreset\.preamp/);
    if (pre) eq.preamp = [Number(pre[1]), Number(pre[2])];
  }
  return { version, endpoints: uniq(endpoints), strings: uniq(strings), playFields: uniq(playFields), seeds: uniq(seeds), eq };
}

/** What changed between two fingerprints, section by section ([] when nothing did). */
export function compare(before, after) {
  const out = [];
  for (const key of ['endpoints', 'strings', 'playFields', 'seeds']) {
    const a = new Set(before?.[key] || []);
    const b = new Set(after[key] || []);
    const added = [...b].filter((x) => !a.has(x));
    const removed = [...a].filter((x) => !b.has(x));
    if (added.length || removed.length) out.push({ key, added, removed });
  }
  if (JSON.stringify(before?.eq || {}) !== JSON.stringify(after.eq || {})) out.push({ key: 'eq', before: before?.eq, after: after.eq });
  return out;
}

/** 1 when `a` is a later version than `b`, -1 when earlier, 0 when the same. */
export function newer(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b ?? '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}

/** The latest app: Yandex's CDN nodes roll a version out one by one and answer differently (5.124.1
 * from one, 5.123.4 from the next), so it asks a few times and takes the latest. */
async function latest() {
  let best = null;
  for (let i = 0; i < 5; i++) {
    const one = await latestOnce();
    if (!best || newer(one.version, best.version) > 0) best = one;
  }
  return best;
}

async function latestOnce() {
  const r = await fetch(FEED + 'latest.yml', { redirect: 'follow' });
  if (!r.ok) throw new Error(`feed: HTTP ${r.status}`);
  const text = await r.text();
  const version = text.match(/^version:\s*(\S+)/m)?.[1];
  const file = text.match(/^path:\s*(\S+)/m)?.[1];
  const sha512 = text.match(/^sha512:\s*>?-?\s*\n?\s*(\S+)/m)?.[1];
  if (!version || !file) throw new Error(`feed: no version in\n${text}`);
  return { version, file, sha512 };
}

/** The new app, downloaded and checked, unpacked down to its app.asar. */
async function unpack({ version, file, sha512 }) {
  const dir = path.join(DATA, version);
  const app = path.join(dir, 'app');
  if (fs.existsSync(path.join(app, 'package.json'))) return app;
  fs.mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, file);
  if (!fs.existsSync(exe)) {
    log('downloading', file);
    const r = await fetch(FEED + file, { redirect: 'follow' });
    if (!r.ok) throw new Error(`download: HTTP ${r.status}`);
    fs.writeFileSync(exe + '.part', Buffer.from(await r.arrayBuffer()));
    fs.renameSync(exe + '.part', exe);
  }
  if (sha512) {
    const got = createHash('sha512').update(fs.readFileSync(exe)).digest('base64');
    if (got !== sha512) throw new Error(`download: sha512 mismatch for ${file}`);
  }
  // An electron-builder installer: NSIS → $PLUGINSDIR/app-64.7z → resources/app.asar.
  const nsis = path.join(dir, 'nsis');
  execFileSync(SEVEN_ZIP, ['x', '-y', `-o${nsis}`, exe], { stdio: 'ignore' });
  const packed = path.join(nsis, '$PLUGINSDIR', 'app-64.7z');
  const files = path.join(dir, 'files');
  execFileSync(SEVEN_ZIP, ['x', '-y', `-o${files}`, packed], { stdio: 'ignore' });
  asar.extractAll(path.join(files, 'resources', 'app.asar'), app);
  // Only the unpacked app is kept: the installer and its parts are 700 MB or so.
  for (const p of [exe, nsis, files]) fs.rmSync(p, { recursive: true, force: true });
  return app;
}

/** The API tests on the real account (they undo what they change). */
function canary() {
  if (flag('--no-canary')) return { ok: true, output: '(skipped)' };
  const r = spawnSync('npm', ['run', 'test:api'], { encoding: 'utf8', shell: true, timeout: 10 * 60_000 });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  const token = process.env.YANDEX_MUSIC_TOKEN;
  return { ok: r.status === 0, output: token ? output.split(token).join('***') : output };
}

function section(change) {
  if (change.key === 'eq') return `### Эквалайзер\n- было: \`${JSON.stringify(change.before)}\`\n- стало: \`${JSON.stringify(change.after)}\``;
  const list = (sign, xs) => xs.map((x) => `- ${sign} \`${x}\``).join('\n');
  return `### ${change.key}\n${[list('+', change.added), list('−', change.removed)].filter(Boolean).join('\n')}`;
}

async function main() {
  let snapshot = null;
  try {
    snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  } catch {}
  const baseline = option('--baseline');
  if (baseline) {
    const fp = fingerprint(baseline);
    fs.writeFileSync(SNAPSHOT, JSON.stringify(fp, null, 2));
    log(`baseline ${fp.version}: ${fp.endpoints.length} endpoints, ${fp.playFields.length} play fields`);
    return 0;
  }

  const feed = await latest();
  log(`official app ${feed.version}, last seen ${snapshot?.version ?? 'none'}`);
  let changes = [];
  let next = null;
  if (newer(feed.version, snapshot?.version) > 0 || flag('--force')) {
    next = fingerprint(await unpack(feed));
    changes = compare(snapshot, next);
    fs.writeFileSync(NEXT, JSON.stringify(next, null, 2));
  }
  const api = canary();
  log(`API tests ${api.ok ? 'pass' : 'FAIL'}; fingerprint ${next ? `${changes.length} section(s) changed` : 'not taken (same app)'}`);

  const code = !api.ok ? 5 : changes.length ? 4 : next ? 3 : 0;
  const report = [
    `# Сторож Яндекс Музыки — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    `- Официальное приложение: **${feed.version}** (прошлое: ${snapshot?.version ?? 'нет'})`,
    `- Тесты API на аккаунте: **${api.ok ? 'проходят' : 'ПАДАЮТ'}**`,
    `- Отпечаток: ${next ? (changes.length ? `изменились разделы: ${changes.map((c) => c.key).join(', ')}` : 'без изменений') : 'не снимался (то же приложение)'}`,
    `- Распакованное приложение: \`${next ? path.join(DATA, feed.version, 'app') : '—'}\``,
    '',
    ...(changes.length ? ['## Что изменилось', '', ...changes.map(section), ''] : []),
    ...(!api.ok ? ['## Вывод тестов API', '', '```', api.output.slice(-6000), '```'] : []),
  ].join('\n');
  fs.writeFileSync(REPORT, report);
  // A new app that changed nothing Oni looks at is taken as the new "before" at once; a change
  // waits until someone has looked: then next-snapshot.json is copied over snapshot.json.
  if (code === 3) fs.copyFileSync(NEXT, SNAPSHOT);
  log(`report: ${REPORT} (exit ${code})`);
  return code;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    log('watch failed:', e?.stack || e);
    process.exit(1);
  },
);
