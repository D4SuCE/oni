// Oni's folder on the user's Yandex Disk ("Приложения/Oni"): the token reaches only that folder
// (cloud_api:disk.app_folder, Oni's own app at oauth.yandex.ru). The shell adds the token, as it
// does for Yandex Music; files go up and down through the links the API hands out.

import type { Transport } from '../api/transport.ts';

const API = 'https://cloud-api.yandex.net/v1/disk/resources';
/** A request that hangs (a stalled network) fails after this long; the next round tries again. */
const TIMEOUT = 20_000;
/** A file sent to an upload server that does not answer goes again through another one: through a
 * VPN some of them are not reached or hang (27.10.2026: 2 of 12 small files), the API answers. */
const SENDS = 3;

function timed<T>(what: Promise<T>, ms = TIMEOUT): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('Yandex Disk: no answer')), ms)));
  return Promise.race([what, late]).finally(() => clearTimeout(timer));
}

/** The token was refused (revoked, expired): Disk has to be connected again. */
export class DiskAuthError extends Error {}

export interface DiskFile {
  name: string;
  /** ISO time of the last change: a file not changed since the last read is not read again. */
  modified: string;
  /** The content's hash: two writes within one second have the same `modified`. */
  md5?: string;
}

/** What DeviceSync needs of Disk; tests give it a fake. */
export interface DiskLike {
  list(): Promise<DiskFile[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export class YandexDisk implements DiskLike {
  private transport: Transport;
  private wait: number;

  /** `wait`: how long a request may hang (tests make it short). */
  constructor(transport: Transport, wait = TIMEOUT) {
    this.transport = transport;
    this.wait = wait;
  }

  private async call<T = any>(method: 'GET' | 'DELETE' | 'PUT' | 'POST', url: string, query: Record<string, string | number>): Promise<{ status: number; data: T }> {
    const r = await timed(this.transport.request<T>({ method, url, query }), this.wait);
    if (r.status === 401) throw new DiskAuthError('Yandex Disk: not authorized');
    return r;
  }

  private fail(what: string, r: { status: number; data: any }): never {
    throw new Error(`Yandex Disk ${what}: HTTP ${r.status} ${r.data?.message ?? r.data?.error ?? ''}`.trim());
  }

  async list(): Promise<DiskFile[]> {
    const r = await this.call('GET', API, { path: 'app:/', limit: 1000, fields: '_embedded.items.name,_embedded.items.modified,_embedded.items.md5,_embedded.items.type' });
    if (r.status === 404) return []; // the folder comes with the first file
    if (r.status !== 200) this.fail('list', r);
    return ((r.data as any)?._embedded?.items ?? []).filter((x: any) => x.type === 'file').map((x: any) => ({ name: x.name, modified: x.modified, md5: x.md5 }));
  }

  async read(name: string): Promise<string> {
    const link = await this.call('GET', `${API}/download`, { path: `app:/${name}` });
    if (link.status !== 200) this.fail('download', link);
    const r = await timed(this.transport.request<string>({ url: (link.data as any).href, responseType: 'text' }), this.wait);
    if (!r.ok) this.fail('download', r);
    return r.data;
  }

  async write(name: string, text: string): Promise<void> {
    for (let i = 1; ; i++) {
      const link = await this.call('GET', `${API}/upload`, { path: `app:/${name}`, overwrite: 'true' });
      if (link.status !== 200) this.fail('upload', link);
      let r;
      try {
        r = await timed(this.transport.request({ method: 'PUT', url: (link.data as any).href, body: text, headers: { 'Content-Type': 'application/json' }, responseType: 'text' }), this.wait);
      } catch (e) {
        // silence or no connection: a new link, another server (an answer, even a refusal, is final)
        if (i < SENDS) continue;
        throw e;
      }
      if (r.status !== 201 && r.status !== 202 && !r.ok) this.fail('upload', r);
      return;
    }
  }

  // ---------------------------------------------------------- a folder of its own (shared uploads)

  /** The files in a folder of Oni's (`path` inside it, as "shared"); none when it is not there. */
  async folder(path: string): Promise<(DiskFile & { size: number })[]> {
    const r = await this.call('GET', API, { path: `app:/${path}`, limit: 10000, fields: '_embedded.items.name,_embedded.items.modified,_embedded.items.md5,_embedded.items.size,_embedded.items.type' });
    if (r.status === 404) return [];
    if (r.status !== 200) this.fail('list', r);
    return ((r.data as any)?._embedded?.items ?? []).filter((x: any) => x.type === 'file').map((x: any) => ({ name: x.name, modified: x.modified, md5: x.md5, size: x.size }));
  }

  /** The folders in a folder of Oni's (the backup's uploads, a folder a playlist). */
  async folders(path: string): Promise<string[]> {
    const r = await this.call('GET', API, { path: `app:/${path}`, limit: 10000, fields: '_embedded.items.name,_embedded.items.type' });
    if (r.status === 404) return [];
    if (r.status !== 200) this.fail('list', r);
    return ((r.data as any)?._embedded?.items ?? []).filter((x: any) => x.type === 'dir').map((x: any) => x.name);
  }

  async mkdir(path: string): Promise<void> {
    const r = await this.call('PUT', API, { path: `app:/${path}` });
    if (r.status !== 201 && r.status !== 409) this.fail('mkdir', r);
  }

  /** A file's bytes (a track), as `path` inside Oni's folder. */
  async writeBytes(path: string, data: ArrayBuffer, type = 'audio/mpeg'): Promise<void> {
    const link = await this.call('GET', `${API}/upload`, { path: `app:/${path}`, overwrite: 'true' });
    if (link.status !== 200) this.fail('upload', link);
    // a track takes longer than a small file: a minute for it
    const r = await this.transport.request({ method: 'PUT', url: (link.data as any).href, body: data, headers: { 'Content-Type': type }, responseType: 'text' });
    if (r.status !== 201 && r.status !== 202 && !r.ok) this.fail('upload', r);
  }

  /** A file the Disk fetches itself from `url` (an upload's stream: no bytes go through the device,
   * so the iPhone shares as the desktop does); done when the Disk says so, in a minute at most. */
  async uploadFrom(path: string, url: string): Promise<void> {
    const r = await this.call('POST', `${API}/upload`, { path: `app:/${path}`, url });
    if (r.status !== 202) this.fail('upload', r);
    const op = (r.data as any)?.href;
    for (let i = 0; op && i < 60; i++) {
      await new Promise((ok) => setTimeout(ok, i ? 1000 : 300));
      const s = await timed(this.transport.request<any>({ url: op }), this.wait);
      if (s.status === 401) throw new DiskAuthError('Yandex Disk: not authorized');
      if (s.data?.status === 'success') return;
      if (s.data?.status === 'failed') throw new Error('Yandex Disk upload: failed');
    }
    throw new Error('Yandex Disk upload: no answer');
  }

  /** A file's bytes, `path` inside Oni's folder (an uploaded track kept by the backup). */
  async readBytes(path: string): Promise<ArrayBuffer> {
    const link = await this.call('GET', `${API}/download`, { path: `app:/${path}` });
    if (link.status !== 200) this.fail('download', link);
    return this.transport.fetchBytes!((link.data as any).href);
  }

  /** A copy made by Disk itself, nothing sent (one track in two playlists of the backup). */
  async copy(from: string, to: string): Promise<void> {
    const r = await this.call('POST', `${API}/copy`, { from: `app:/${from}`, path: `app:/${to}`, overwrite: 'true' });
    if (r.status !== 201 && r.status !== 202) this.fail('copy', r);
  }

  /** Opens a folder to anyone with its link; the link (yadi.sk/d/…). */
  async publish(path: string): Promise<string> {
    const r = await this.call('PUT', `${API}/publish`, { path: `app:/${path}` });
    if (r.status !== 200) this.fail('publish', r);
    const meta = await this.call('GET', API, { path: `app:/${path}`, fields: 'public_url' });
    if (meta.status !== 200 || !(meta.data as any)?.public_url) this.fail('publish', meta);
    return (meta.data as any).public_url;
  }

  async remove(name: string): Promise<void> {
    const r = await this.call('DELETE', API, { path: `app:/${name}`, permanently: 'true' });
    if (r.status !== 202 && r.status !== 204 && r.status !== 404) this.fail('remove', r);
  }
}
