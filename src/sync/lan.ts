// The remote on the home network (the user, 25.10.2026: "as fast as possible"): the PC listens
// (electron/lan.cjs) and says where in Oni's folder on Disk (lan-<id>.json, with a key); the phone
// connects to it (OniLan, ios/App/App/OniBridge.swift). Over the link a press and what plays go at
// once; Disk stays the way when there is no link (another network, the link refused).

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { transport } from '../api/client.ts';
import { isIos } from '../ui/platform.ts';
import type { Device } from './devices.ts';
import type { LanFile } from './playing.ts';

/** The PC's side, from its shell (electron/preload.cjs). */
export interface LanServer {
  start(device: Device): Promise<{ hosts: string[]; port: number; key: string } | null>;
  stop(): Promise<void>;
  send(to: string | null, text: string): void;
  onMessage(cb: (m: { from: string; text: string }) => void): void;
  onPeers(cb: (ids: string[]) => void): void;
}

interface LanPlugin {
  open(o: { id: string; url: string; hello: string; timeout?: number }): Promise<void>;
  send(o: { id: string; text: string }): Promise<void>;
  close(o: { id: string }): Promise<void>;
  addListener(event: 'message', cb: (e: { id: string; text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'closed', cb: (e: { id: string }) => void): Promise<PluginListenerHandle>;
}

const OniLan = isIos ? registerPlugin<LanPlugin>('OniLan') : null;
const server = (transport as { lan?: LanServer }).lan ?? null;

/** Links to the other devices, whichever end this one is. */
export class Lan {
  /** The devices linked now, by id. */
  private open = new Set<string>();
  /** Being connected to (phone), with the file it was for: the same file is not tried again and again. */
  private trying = new Map<string, number>();
  private tried = new Map<string, { at: number; file: number }>();
  private onText: (from: string, text: string) => void = () => {};
  private onChange: () => void = () => {};

  /** This device can listen (the PC) or connect (the phone). */
  static get possible() {
    return Boolean(server || OniLan);
  }

  /** `onText`: a message from a linked device; `onChange`: a link came or went. */
  constructor(onText: (from: string, text: string) => void, onChange: () => void) {
    this.onText = onText;
    this.onChange = onChange;
    server?.onMessage(({ from, text }) => this.onText(from, text));
    server?.onPeers((ids) => {
      this.open = new Set(ids);
      this.onChange();
    });
    void OniLan?.addListener('message', ({ id, text }) => this.onText(id, text));
    void OniLan?.addListener('closed', ({ id }) => {
      if (this.open.delete(id)) this.onChange();
    });
  }

  /** The PC starts listening; what goes in its file on Disk (null: it cannot, or this is not a PC). */
  async listen(device: Device): Promise<Omit<LanFile, 'at'> | null> {
    if (!server) return null;
    const info = await server.start(device).catch(() => null);
    return info?.hosts.length ? { v: 1, device, ...info, ...(transport.testMode ? { test: true } : {}) } : null;
  }

  /** The phone connects to a PC from its file; tried again only for a newer file or after a while. */
  async connect(device: Device, file: LanFile) {
    const id = file.device.id;
    if (!OniLan || this.open.has(id) || this.trying.has(id)) return;
    const last = this.tried.get(id);
    if (last && last.file === file.at && Date.now() - last.at < RETRY) return;
    this.trying.set(id, file.at);
    this.tried.set(id, { at: Date.now(), file: file.at });
    const hello = JSON.stringify({ t: 'hello', key: file.key, device });
    try {
      for (const host of file.hosts) {
        try {
          await OniLan.open({ id, url: `ws://${host}:${file.port}`, hello, timeout: 2500 });
          this.open.add(id);
          this.onChange();
          return;
        } catch {
          /* the next address */
        }
      }
    } finally {
      this.trying.delete(id);
    }
  }

  isOpen(id: string) {
    return this.open.has(id);
  }

  /** Sends to `to` if linked; false when not (then it goes through Disk alone). */
  send(to: string, text: string) {
    if (!this.open.has(to)) return false;
    if (server) server.send(to, text);
    else void OniLan?.send({ id: to, text }).catch(() => {});
    return true;
  }

  /** To every device linked. */
  broadcast(text: string) {
    for (const id of this.open) this.send(id, text);
  }

  async stop() {
    if (server) await server.stop().catch(() => {});
    for (const id of this.open) await OniLan?.close({ id }).catch(() => {});
    this.open.clear();
    this.onChange();
  }
}

/** A PC not reached is tried again after this long even with the same file (back on the home Wi-Fi). */
const RETRY = 60_000;
