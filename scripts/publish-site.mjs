// Publishes site/ (the page "Share" links to, src/ui/links.ts) to https://oni-music.github.io/:
// the repository oni-music/oni-music.github.io, served by GitHub Pages from its main branch.
// Each file is written through the GitHub API (gh, signed in as the organization's owner); one that
// has not changed is left alone. Run: npm run site
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = 'oni-music/oni-music.github.io';
const dir = path.resolve(import.meta.dirname, '..', 'site');
const gh = (args, input) => execFileSync('gh', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

for (const name of fs.readdirSync(dir)) {
  const content = fs.readFileSync(path.join(dir, name)).toString('base64');
  let sha;
  try {
    const now = JSON.parse(gh(['api', `repos/${REPO}/contents/${name}`]));
    if (now.content.replace(/\s/g, '') === content) {
      console.log(`  same  ${name}`);
      continue;
    }
    sha = now.sha;
  } catch {
    // not there yet
  }
  gh(['api', '-X', 'PUT', `repos/${REPO}/contents/${name}`, '--input', '-'], JSON.stringify({ message: `Update ${name}`, content, ...(sha && { sha }) }));
  console.log(`  sent  ${name}`);
}
console.log(`https://oni-music.github.io/ (GitHub Pages updates in about a minute)`);
