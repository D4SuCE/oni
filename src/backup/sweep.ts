// What the backup's files no longer need goes (backup.ts says what they are). Apart, so a test
// can run it over a Disk in memory: it removes files on the user's Disk.

import type { DiskFile } from '../sync/disk.ts';
import type { Backup } from './backup.ts';

export interface SweepDisk {
  folder(path: string): Promise<DiskFile[]>;
  folders(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

/** A file of the old folders (`old`, a folder a playlist) goes when no kept copy names it, or when
 * its track is in the shared folder (`pool`) now; a folder left empty goes too. A track's file in
 * the shared folder goes when no copy names it and no playlist has it (`met`: the uploads in the
 * playlists now, kept or not). */
export async function sweepUploads(disk: SweepDisk, copies: Backup[], met: Set<string>, at: { pool: string; old: string }) {
  const named = new Map(copies.flatMap((c) => Object.entries(c.uploads ?? {}).flatMap(([id, u]) => u.files.map((f) => [f, id] as const))));
  const pool = new Set((await disk.folder(at.pool)).map((f) => f.name));
  for (const dir of await disk.folders(at.old)) {
    const folder = `${at.old}/${dir}`;
    const files = await disk.folder(folder);
    const gone = files.filter((f) => {
      const id = named.get(`${folder}/${f.name}`);
      return !id || pool.has(`${id}.mp3`);
    });
    for (const f of gone) await disk.remove(`${folder}/${f.name}`);
    if (gone.length === files.length) await disk.remove(folder);
  }
  const ids = new Set(named.values());
  for (const name of pool) {
    const id = name.replace(/\.mp3$/, '');
    if (id !== name && !ids.has(id) && !met.has(id)) await disk.remove(`${at.pool}/${name}`);
  }
}
