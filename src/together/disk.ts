// A room from afar (docs/together.md): each member's device with Yandex Disk keeps its file in the
// open folder "together" of Oni's folder on it; the others read it by the folder's link, with no
// sign-in. One writer per file, as with the remote (sync/playing.ts): a file per device, since two
// devices of one account share one folder (the user, 29.10.2026: his PC and iPhone in one room
// stayed «Together · 1», each overwriting the other's file and not reading its "own" folder). Nobody
// can write into another's Disk, so the one who started learns of a guest by the guest's own link
// (pressed once: the friend is then known for good, together/index.ts).

import type { DiskFile, DiskLike } from '../sync/disk.ts';
import type { Fetch } from '../share/shared.ts';
import type { MemberFile } from './room.ts';

export const FOLDER = 'together';
const PUBLIC = 'https://cloud-api.yandex.net/v1/disk/public/resources';

const prefixOf = (room: string) => `room-${room}-`;
export const fileOf = (room: string, device: string) => `${prefixOf(room)}${device}.json`;
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
  await disk.write(`${FOLDER}/${fileOf(file.room, file.me.device.id)}`, JSON.stringify(file));
}

export async function removeMine(disk: OwnDisk, room: string, device: string) {
  await disk.remove(`${FOLDER}/${fileOf(room, device)}`);
}

/** A track sent to the room is taken away a day after it was sent at the latest. */
const TRACK_KEPT = 24 * 60 * 60_000;

/**
 * What a room left in the folder when Oni was closed (or the iPhone put it away) without "Leave" —
 * only "Leave" takes its files away (the user, 30.10.2026: five such files from the day before;
 * nobody reads them again). This device's room files not written for `stale` (a room not resumed:
 * one in use is written every few seconds), and tracks sent more than a day ago (the account's
 * other device may be in a room with a newer one). Names inside the folder.
 */
export function leftovers(files: DiskFile[], device: string, now: number, stale: number): string[] {
  const age = (f: DiskFile) => now - Date.parse(f.modified);
  return files
    .filter((f) => (f.name.startsWith('room-') && f.name.endsWith(`-${device}.json`) && age(f) > stale) || (f.name.endsWith('.mp3') && age(f) > TRACK_KEPT))
    .map((f) => f.name);
}

/** The members' folders (this one's own too: another device of the account writes there), read by
 * their links: a file is read again only when it changed. */
export class Folders {
  private fetch: Fetch;
  private stamps = new Map<string, string>();

  constructor(fetch: Fetch) {
    this.fetch = fetch;
  }

  /** The room's files in the folders that are new or changed, but this device's own (`me`: its id). */
  async poll(room: string, links: string[], me: string): Promise<MemberFile[]> {
    const out = await Promise.all(links.map((id) => this.folder(id, room, fileOf(room, me)).catch(() => [])));
    return out.flat();
  }

  private async folder(id: string, room: string, own: string): Promise<MemberFile[]> {
    const r = await this.fetch<any>({ url: PUBLIC, query: { public_key: linkUrl(id), path: '/', limit: 200, fields: '_embedded.items.name,_embedded.items.md5,_embedded.items.modified' } });
    if (!r.ok) return [];
    const items = (r.data?._embedded?.items ?? []).filter((x: any) => typeof x.name === 'string' && x.name.startsWith(prefixOf(room)) && x.name.endsWith('.json') && x.name !== own);
    const files = await Promise.all(items.map((item: any) => this.read(id, item).catch(() => null)));
    return files.filter((f): f is MemberFile => Boolean(f));
  }

  private async read(id: string, item: { name: string; modified?: string; md5?: string }): Promise<MemberFile | null> {
    const stamp = `${item.modified}|${item.md5 ?? ''}`;
    const key = `${id}/${item.name}`;
    if (this.stamps.get(key) === stamp) return null;
    const link = await this.fetch<{ href?: string }>({ url: `${PUBLIC}/download`, query: { public_key: linkUrl(id), path: `/${item.name}` } });
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
