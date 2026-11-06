// All the end-to-end scripts, one after another, each to its end: they used to be joined by && in
// package.json, so a failure in the first one kept the other four from running, and what was broken
// there showed only on the next run (one more ~10 minutes on GitHub). The run fails if any did.
// Run: npm run test:e2e (after vite build)
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const scripts = ['e2e', 'desktop', 'update', 'login', 'offline'];
const failed = [];
for (const name of scripts) {
  console.log(`\n=== ${name}`);
  const started = Date.now();
  const { status, signal } = spawnSync(process.execPath, [path.join(import.meta.dirname, `${name}.mjs`)], { stdio: 'inherit' });
  console.log(`=== ${name}: ${status === 0 ? 'ok' : `FAIL (${signal ?? `exit ${status}`})`} in ${Math.round((Date.now() - started) / 1000)} s`);
  if (status !== 0) failed.push(name);
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : '\nAll the e2e scripts passed.');
process.exit(failed.length ? 1 : 0);
