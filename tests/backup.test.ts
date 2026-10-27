// Offline unit tests for the backup's files (src/backup/sweep.ts) over a Disk in memory: each
// upload kept once, in the shared folder (the user, 27.10.2026: "one time"); the old folders of the
// copies, a folder a playlist, go as their tracks reach it; nothing a kept copy needs goes.
// Run: npm run test:backup
import type { Backup } from '../src/backup/backup.ts';
import { sweepUploads, type SweepDisk } from '../src/backup/sweep.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.stack || e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Files by path; a folder is there while a path starts with it. */
function fakeDisk(paths: string[]) {
  const files = new Set(paths);
  const disk: SweepDisk = {
    async folder(path) {
      return [...files].filter((f) => f.startsWith(`${path}/`) && !f.slice(path.length + 1).includes('/')).map((f) => ({ name: f.slice(path.length + 1), modified: '' }));
    },
    async folders(path) {
      return [...new Set([...files].filter((f) => f.startsWith(`${path}/`) && f.slice(path.length + 1).includes('/')).map((f) => f.slice(path.length + 1).split('/')[0]))];
    },
    async remove(path) {
      for (const f of files) if (f === path || f.startsWith(`${path}/`)) files.delete(f);
    },
  };
  return { disk, files };
}

const AT = { pool: 'shared', old: 'backup/uploads' };
const copy = (uploads: Record<string, string[]>): Backup => ({
  v: 1,
  at: 0,
  likes: [],
  playlists: [],
  uploads: Object.fromEntries(Object.entries(uploads).map(([id, files]) => [id, { title: id, artists: [], files }])),
});

await test("an old copy's file goes once its track is in the shared folder, though the old copy names it", async () => {
  const { disk, files } = fakeDisk(['shared/1.mp3', 'shared/index.json', 'backup/uploads/Mix/A - One.mp3', 'backup/uploads/Rock/A - One.mp3']);
  const today = copy({ 1: ['shared/1.mp3'] });
  const before = copy({ 1: ['backup/uploads/Mix/A - One.mp3', 'backup/uploads/Rock/A - One.mp3'] });
  await sweepUploads(disk, [today, before], new Set(['1']), AT);
  assert([...files].sort().join() === 'shared/1.mp3,shared/index.json', `left ${[...files]}`);
});

await test("an old copy's file whose track is not in the shared folder stays while the copy is kept", async () => {
  const { disk, files } = fakeDisk(['backup/uploads/Mix/B - Two.mp3', 'backup/uploads/Mix/C - Gone.mp3']);
  const before = copy({ 2: ['backup/uploads/Mix/B - Two.mp3'] });
  await sweepUploads(disk, [copy({}), before], new Set(), AT);
  assert([...files].join() === 'backup/uploads/Mix/B - Two.mp3', `left ${[...files]}`);
});

await test('a shared file stays while a kept copy names it, after its track left the playlists', async () => {
  const { disk, files } = fakeDisk(['shared/3.mp3', 'shared/4.mp3', 'shared/index.json']);
  await sweepUploads(disk, [copy({ 4: ['shared/4.mp3'] }), copy({ 3: ['shared/3.mp3'] })], new Set(['4']), AT);
  assert(files.has('shared/3.mp3') && files.has('shared/4.mp3'), `left ${[...files]}`);
});

await test('a shared file of a track in a playlist stays though no copy names it yet (its keeping failed today)', async () => {
  const { disk, files } = fakeDisk(['shared/5.mp3']);
  await sweepUploads(disk, [copy({})], new Set(['5']), AT);
  assert(files.has('shared/5.mp3'), `left ${[...files]}`);
});

await test('a shared file no copy names and no playlist has goes; the index stays', async () => {
  const { disk, files } = fakeDisk(['shared/6.mp3', 'shared/index.json']);
  await sweepUploads(disk, [copy({})], new Set(), AT);
  assert([...files].join() === 'shared/index.json', `left ${[...files]}`);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
