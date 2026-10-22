// Publishes the current version to GitHub Releases (D4SuCE/oni-releases, see build.publish
// in package.json): builds the installer and the portable exe, uploads them with latest.yml,
// which the installed apps poll, and uses the version's CHANGELOG.md section as the notes.
// The release stays a draft until every file is up, so no app sees it half-uploaded.
// Needs `gh auth login`. Run: npm run release (after committing and tagging the version).
import { execSync, spawnSync } from 'node:child_process';
import { releaseIos } from './ios-release.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const REPO = 'D4SuCE/oni-releases';
const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;

if (sh('git status --porcelain')) fail('commit your changes first');
if (!sh('git tag --points-at HEAD').split('\n').includes(tag)) fail(`HEAD is not tagged ${tag} (see "Выпуск версии" in README)`);

// The version's section of CHANGELOG.md, without its heading.
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const section = changelog.split(/^## /m).find((s) => s.startsWith(`[${version}]`));
if (!section) fail(`CHANGELOG.md has no "## [${version}]" section`);
const notes = section.slice(section.indexOf('\n') + 1).split(/^\[.+\]: /m)[0].trim();

// A separate folder per version: an Oni started from release/win-unpacked would lock the default one.
const out = path.join('release', tag);
fs.mkdirSync(path.join(root, out), { recursive: true });
const notesFile = path.join(out, 'notes.md');
fs.writeFileSync(path.join(root, notesFile), notes + '\n');

const run = (cmd, env = process.env) => {
  const r = spawnSync(cmd, { cwd: root, stdio: 'inherit', shell: true, env });
  if (r.status !== 0) fail(`"${cmd.split(' ').slice(0, 3).join(' ')}" failed`);
};
const released = (() => {
  try {
    return JSON.parse(sh(`gh release view ${tag} -R ${REPO} --json isDraft`));
  } catch {
    return null;
  }
})();
if (released && !released.isDraft) fail(`${tag} is already published`);

run('npx vite build');
// Created up front: the installer and the portable target publish in parallel and would
// race to create the release themselves.
if (!released) run(`gh release create ${tag} -R ${REPO} --draft --title "Oni ${version}" --notes-file ${notesFile}`);
run(`npx electron-builder --win --publish always -c.directories.output=${out}`, { ...process.env, GH_TOKEN: sh('gh auth token') });
// The iPhone build of the same tag (the tag push started it); a failure there does not hold back Windows.
try {
  await releaseIos(tag, notes);
} catch (e) {
  console.warn(`release: iOS skipped (${e.message}); later: node scripts/ios-release.mjs ${tag}`);
}
run(`gh release edit ${tag} -R ${REPO} --draft=false --latest`);
// The installers are on GitHub now: the local copies go (each version's folder was ~600 MB, and
// they filled the disk). The notes stay, for a later `node scripts/ios-release.mjs <tag>`.
for (const name of fs.readdirSync(path.join(root, out))) if (name !== 'notes.md') fs.rmSync(path.join(root, out, name), { recursive: true, force: true });
console.log(`\nreleased ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
