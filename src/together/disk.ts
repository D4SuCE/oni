// A room from afar (docs/together.md): each member with Yandex Disk keeps his file in the open folder
// "together" of Oni's folder on it; the others read it by the folder's link, with no sign-in. One
// writer per file, as with the remote (sync/playing.ts): nothing is overwritten by another. Nobody
// can write into another's Disk, so the one who started learns of a guest by the guest's own link
// (pressed once: the friend is then known for good, together/index.ts).

import type { DiskLike } from '../sync/disk.ts';
import type { Fetch } from '../share/shared.ts';
import type { MemberFile } from './room.ts';

export const FOLDER = 'together';
const PUBLIC = 'https://cloud-api.yandex.net/v1/disk/public/resources';

export const fileOf = (room: string) => `room-${room}.json`;
/** A folder's link from its id (the part after /d/), and back. */
export const linkUrl = (id: string) => `https://disk.yandex.ru/d/${id}`;
export function linkId(url: string): string | null {
  const m = /\/d\/([\w-]+)/.exec(url);
  return m ? m[1] : null;
}

/** What this device needs of its own Disk (sync/disk.ts's YandexDisk). */
export interface OwnDisk extends DiskLike {
  mkdir(path: string): Promise<void>;
  publish(path: string): Promise<string>;
}

/** This device's folder: made and opened once; its link's id. */
export async function openFolder(disk: OwnDisk): Promise<string> {
  await disk.mkdir(FOLDER);
  const id = linkId(await disk.publish(FOLDER));
  if (!id) throw new Error('Yandex Disk gave no link to the folder');
  return id;
}

export async function writeMine(disk: OwnDisk, file: MemberFile) {
  await disk.write(`${FOLDER}/${fileOf(file.room)}`, JSON.stringify(file));
}

export async function removeMine(disk: OwnDisk, room: string) {
  await disk.remove(`${FOLDER}/${fileOf(room)}`);
}

/** The others' folders, read by their links: a file is read again only when it changed. */
export class Folders {
  private fetch: Fetch;
  private stamps = new Map<string, string>();

  constructor(fetch: Fetch) {
    this.fetch = fetch;
  }

  /** The room's file in each folder that has a new one (none there, or not changed: nothing). */
  async poll(room: string, links: string[]): Promise<MemberFile[]> {
    const name = fileOf(room);
    const out = await Promise.all(links.map((id) => this.one(id, name).catch(() => null)));
    return out.filter((f): f is MemberFile => Boolean(f));
  }

  /** Any of the folders has a file of this room (a friend's Oni looking whether he is in it). */
  private async one(id: string, name: string): Promise<MemberFile | null> {
    const r = await this.fetch<any>({ url: PUBLIC, query: { public_key: linkUrl(id), path: '/', limit: 200, fields: '_embedded.items.name,_embedded.items.md5,_embedded.items.modified' } });
    if (!r.ok) return null;
    const item = (r.data?._embedded?.items ?? []).find((x: any) => x.name === name);
    if (!item) return null;
    const stamp = `${item.modified}|${item.md5 ?? ''}`;
    const key = `${id}/${name}`;
    if (this.stamps.get(key) === stamp) return null;
    const link = await this.fetch<{ href?: string }>({ url: `${PUBLIC}/download`, query: { public_key: linkUrl(id), path: `/${name}` } });
    if (!link.ok || !link.data?.href) return null;
    const text = await this.fetch<string>({ url: link.data.href, responseType: 'text' });
    if (!text.ok) return null;
    let file: MemberFile;
    try {
      file = JSON.parse(text.data) as MemberFile;
    } catch {
      return null;
    }
    this.stamps.set(key, stamp);
    return file;
  }

  /** Forgets what was read (a new room). */
  clear() {
    this.stamps.clear();
  }
}
