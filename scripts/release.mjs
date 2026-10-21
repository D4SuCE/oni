// Publishes the current version to GitHub Releases (D4SuCE/oni-releases, see build.publish
// in package.json): builds the installer and the portable exe, uploads them with latest.yml,
// which the installed apps poll, and uses the version's CHANGELOG.md section as the notes.
// Needs `gh auth login`. Run: npm run release (after committing and tagging the version).
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
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
run('npx vite build');
run(
  `npx electron-builder --win --publish always -c.directories.output=${out} -c.releaseInfo.releaseName="Oni ${version}" -c.releaseInfo.releaseNotesFile=${notesFile}`,
  { ...process.env, GH_TOKEN: sh('gh auth token') },
);
console.log(`\nreleased ${tag}: https://github.com/D4SuCE/oni-releases/releases/tag/${tag}`);
