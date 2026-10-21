// The iPhone side of a release: waits for the cloud build of the version tag
// (.github/workflows/ios.yml), attaches its unsigned Oni-<version>.ipa to the release in
// D4SuCE/oni-releases and adds the version to sidestore.json there, the source SideStore
// polls: it signs the IPA on the phone and keeps it up to date (docs/ios-signing.md, path A).
// Called by scripts/release.mjs before the release goes public; on its own:
//   node scripts/ios-release.mjs v1.4.0
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODE = 'D4SuCE/oni';
const RELEASES = 'D4SuCE/oni-releases';
const SOURCE = 'sidestore.json';
const RAW = `https://raw.githubusercontent.com/${RELEASES}/main`;
const WAIT = 40 * 60 * 1000;

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The ios workflow run for the tag, once it has finished. */
async function finishedRun(tag) {
  const end = Date.now() + WAIT;
  while (Date.now() < end) {
    const [run] = JSON.parse(gh('run', 'list', '-R', CODE, '--workflow', 'ios', '--branch', tag, '--limit', '1', '--json', 'databaseId,number,status,conclusion'));
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`the iOS build for ${tag} ended with "${run.conclusion}"`);
      return run;
    }
    console.log(run ? `iOS build for ${tag}: ${run.status}…` : `waiting for the iOS build of ${tag} to start…`);
    await sleep(30000);
  }
  throw new Error(`the iOS build for ${tag} did not finish in ${WAIT / 60000} min`);
}

function emptySource() {
  const description =
    'Неофициальный клиент Яндекс Музыки в японском стиле: «Моя волна» без повторов, Daylist, ' +
    'подборки в духе Spotify. Не связан с Яндексом. Для полных треков нужна подписка Яндекс Плюс.';
  return {
    name: 'Oni',
    identifier: 'io.github.d4suce.oni',
    subtitle: 'Неофициальный клиент Яндекс Музыки',
    description,
    iconURL: `${RAW}/assets/logo.png`,
    website: `https://github.com/${RELEASES}`,
    tintColor: 'D9272E',
    apps: [
      {
        name: 'Oni',
        bundleIdentifier: 'local.wave.player',
        developerName: 'D4SuCE',
        subtitle: 'Яндекс Музыка в японском стиле',
        localizedDescription: description,
        iconURL: `${RAW}/assets/logo.png`,
        tintColor: 'D9272E',
        category: 'entertainment',
        screenshots: [],
        versions: [],
        appPermissions: { entitlements: [], privacy: {} },
      },
    ],
    news: [],
  };
}

/** Reads sidestore.json from the releases repo (with its sha for the update), or a fresh one. */
function readSource() {
  try {
    const file = JSON.parse(gh('api', `repos/${RELEASES}/contents/${SOURCE}`));
    return { source: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), sha: file.sha };
  } catch {
    return { source: emptySource(), sha: undefined };
  }
}

export async function releaseIos(tag, notes = '') {
  const version = tag.replace(/^v/, '');
  const run = await finishedRun(tag);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oni-ipa-'));
  try {
    gh('run', 'download', String(run.databaseId), '-R', CODE, '-n', 'ios', '-D', dir);
    const ipa = path.join(dir, `Oni-${version}.ipa`);
    if (!fs.existsSync(ipa)) throw new Error(`the iOS build of ${tag} has no Oni-${version}.ipa`);
    gh('release', 'upload', tag, ipa, '-R', RELEASES, '--clobber');

    const { source, sha } = readSource();
    const app = source.apps[0];
    app.versions = [
      {
        version,
        buildVersion: String(run.number),
        date: new Date().toISOString(),
        // SideStore shows plain text: no markdown headings.
        localizedDescription: notes.replace(/^#+\s*/gm, '') || `Oni ${version}`,
        downloadURL: `https://github.com/${RELEASES}/releases/download/${tag}/Oni-${version}.ipa`,
        size: fs.statSync(ipa).size,
        minOSVersion: '15.0',
      },
      ...app.versions.filter((v) => v.version !== version),
    ];
    const body = path.join(dir, 'body.json');
    fs.writeFileSync(
      body,
      JSON.stringify({ message: `SideStore: Oni ${version}`, content: Buffer.from(JSON.stringify(source, null, 2) + '\n').toString('base64'), ...(sha ? { sha } : {}) }),
    );
    gh('api', '-X', 'PUT', `repos/${RELEASES}/contents/${SOURCE}`, '--input', body);
    console.log(`iOS: Oni-${version}.ipa attached, ${SOURCE} updated (build ${run.number})`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const tag = process.argv[2];
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) {
    console.error('usage: node scripts/ios-release.mjs v1.2.3');
    process.exit(1);
  }
  const notesFile = path.join(import.meta.dirname, '..', 'release', tag, 'notes.md');
  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '';
  releaseIos(tag, notes).catch((e) => {
    console.error(`ios-release: ${e.message}`);
    process.exit(1);
  });
}
