// A room on the home network (docs/together.md): the device of the one who started listens (the PC:
// electron/together.cjs; the iPhone: LanPlugin.swift's serve), a guest's device connects to it
// (the PC from its shell, the iPhone through OniLan as the remote does: its ids here begin with
// "tog-", so the remote's link leaves them alone). Only carried here; the sense is in index.ts.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { transport } from '../api/client.ts';
import { isIos } from '../ui/platform.ts';
import type { Device } from '../sync/devices.ts';

interface Shell {
  serve(key: string, device: Device): Promise<{ hosts: string[]; port: number } | null>;
  stopServing(): Promise<void>;
  connect(id: string, url: string, hello: string): Promise<void>;
  close(id: string): Promise<void>;
  send(to: string | null, text: string): void;
  onMessage(cb: (m: { from: string; text: string }) => void): void;
  onPeers(cb: (ids: string[]) => void): void;
  onClosed(cb: (id: string) => void): void;
}

interface Plugin {
  open(o: { id: string; url: string; hello: string; timeout?: number }): Promise<void>;
  send(o: { id: string; text: string }): Promise<void>;
  close(o: { id: string }): Promise<void>;
  serve(o: { key: string; welcome: string }): Promise<{ hosts: string[]; port: number }>;
  serveSend(o: { to?: string; text: string }): Promise<void>;
  serveStop(): Promise<void>;
  addListener(event: 'message', cb: (e: { id: string; text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'closed', cb: (e: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'guestMessage', cb: (e: { id: string; text: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'guests', cb: (e: { ids: string[] }) => void): Promise<PluginListenerHandle>;
}

const OniLan = isIos ? registerPlugin<Plugin>('OniLan') : null;
const shell = (transport as { together?: Shell }).together ?? null;
const PREFIX = 'tog-';

export interface LanEvents {
  /** A message from a guest (this one listens) or from the one who started (this one is a guest). */
  text(from: string, text: string): void;
  /** The guests connected now (this one listens). */
  guests(ids: string[]): void;
  /** The link to the one who started is gone. */
  closed(id: string): void;
}

export class RoomLan {
  private on: LanEvents;
  /** Connected to, as a guest (the device id of the one who started). */
  private host: string | null = null;
  private guests: string[] = [];

  static get possible() {
    return Boolean(shell || OniLan);
  }

  constructor(on: LanEvents) {
    this.on = on;
    shell?.onMessage(({ from, text }) => this.on.text(from, text));
    shell?.onPeers((ids) => this.setGuests(ids));
    shell?.onClosed((id) => this.lost(id));
    void OniLan?.addListener('guestMessage', ({ id, text }) => this.on.text(id, text));
    void OniLan?.addListener('guests', ({ ids }) => this.setGuests(ids));
    void OniLan?.addListener('message', ({ id, text }) => id.startsWith(PREFIX) && this.on.text(id.slice(PREFIX.length), text));
    void OniLan?.addListener('closed', ({ id }) => id.startsWith(PREFIX) && this.lost(id.slice(PREFIX.length)));
  }

  private setGuests(ids: string[]) {
    this.guests = ids;
    this.on.guests(ids);
  }

  private lost(id: string) {
    if (this.host !== id) return;
    this.host = null;
    this.on.closed(id);
  }

  /** Listens for guests (the one who started); where, or null when it cannot. */
  async serve(key: string, me: Device): Promise<{ hosts: string[]; port: number } | null> {
    try {
      const info = shell ? await shell.serve(key, me) : OniLan ? await OniLan.serve({ key, welcome: JSON.stringify({ t: 'welcome', device: me }) }) : null;
      return info?.hosts.length ? info : null;
    } catch {
      return null;
    }
  }

  /** Connects to the one who started (`host`: his device id), trying each address; true once linked. */
  async connect(host: string, hosts: string[], port: number, key: string, me: Device): Promise<boolean> {
    if (this.host === host) return true;
    const hello = JSON.stringify({ t: 'hello', key, device: me });
    for (const address of hosts) {
      const url = `ws://${address}:${port}`;
      try {
        if (shell) await shell.connect(host, url, hello);
        else if (OniLan) await OniLan.open({ id: PREFIX + host, url, hello, timeout: 2500 });
        else return false;
        this.host = host;
        return true;
      } catch {
        /* the next address */
      }
    }
    return false;
  }

  get linkedTo() {
    return this.host;
  }

  get guestIds() {
    return this.guests;
  }

  /** To the one who started (a guest), or to the guests (`to`: one of them; null: all). */
  send(text: string, to: string | null = null) {
    if (this.host) {
      if (shell) shell.send(this.host, text);
      else void OniLan?.send({ id: PREFIX + this.host, text }).catch(() => {});
      return;
    }
    if (!this.guests.length) return;
    if (shell) shell.send(to, text);
    else void OniLan?.serveSend({ ...(to ? { to } : {}), text }).catch(() => {});
  }

  async stop() {
    const host = this.host;
    this.host = null;
    if (host) await (shell ? shell.close(host) : OniLan?.close({ id: PREFIX + host }))?.catch(() => {});
    await (shell ? shell.stopServing() : OniLan?.serveStop())?.catch(() => {});
    this.setGuests([]);
  }
}
