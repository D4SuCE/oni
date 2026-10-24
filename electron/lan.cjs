// The remote on the home network (the user, 25.10.2026: "as fast as possible"): the PC listens on
// its home network and the phone connects to it, so a press arrives at once instead of through
// Yandex Disk in 2–4 s (src/sync/elsewhere.ts). Where to connect and the key go in Oni's folder on
// the account's Disk (lan-<id>.json), so only the account's devices know them; a connection without
// the key is closed. The page makes the sense of the messages; here they are only carried.

const crypto = require('node:crypto');
const os = require('node:os');
const { ipcMain } = require('electron');
const { WebSocketServer } = require('ws');

/** A connection that has not said the key by then is closed. */
const HELLO_WITHIN = 5000;
const PING_EVERY = 20_000;

/** The PC's addresses on home networks, the likeliest first; a VPN's adapter is left out. */
function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/tun|tap|vpn|wireguard|happ|virtual|vethernet|loopback/i.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const rank = a.address.startsWith('192.168.') ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 1 : a.address.startsWith('10.') ? 2 : -1;
      if (rank >= 0) out.push({ address: a.address, rank });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((a) => a.address);
}

function sameKey(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** `window()`: the main window, where the messages go; tests listen on this computer only. */
function setupLan(window, { testMode, writeLog }) {
  let server = null;
  let info = null;
  let me = null;
  /** The devices connected, by their id. */
  const peers = new Map();

  const toPage = (channel, data) => {
    const w = window();
    if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  };
  const tellPeers = () => toPage('lan:peers', [...peers.keys()]);

  function start(device) {
    me = device;
    if (info) return Promise.resolve(info);
    const key = crypto.randomBytes(24).toString('base64url');
    return new Promise((resolve) => {
      server = new WebSocketServer({ host: testMode ? '127.0.0.1' : '0.0.0.0', port: 0, maxPayload: 4 * 1024 * 1024 });
      server.on('error', (e) => {
        writeLog('warn', 'lan', `server: ${e.message}`);
        resolve(null);
      });
      server.on('listening', () => {
        info = { port: server.address().port, key, hosts: testMode ? ['127.0.0.1'] : addresses() };
        resolve(info);
      });
      server.on('connection', (ws) => {
        let id = null;
        let alive = true;
        const hello = setTimeout(() => !id && ws.close(4001, 'no key'), HELLO_WITHIN);
        const ping = setInterval(() => {
          if (!alive) return ws.terminate();
          alive = false;
          ws.ping();
        }, PING_EVERY);
        ws.on('pong', () => (alive = true));
        ws.on('message', (raw, binary) => {
          if (binary) return;
          const text = raw.toString();
          if (!id) {
            let msg = null;
            try {
              msg = JSON.parse(text);
            } catch {
              /* not ours */
            }
            if (msg?.t !== 'hello' || !sameKey(msg.key, key) || !msg.device?.id) return ws.close(4001, 'bad key');
            clearTimeout(hello);
            id = String(msg.device.id);
            // The same device again (a new connection after a sleep): the old one goes.
            peers.get(id)?.close(4002, 'replaced');
            peers.set(id, ws);
            ws.send(JSON.stringify({ t: 'welcome', device: me }));
            tellPeers();
            return;
          }
          toPage('lan:message', { from: id, text });
        });
        ws.on('close', () => {
          clearTimeout(hello);
          clearInterval(ping);
          if (id && peers.get(id) === ws) {
            peers.delete(id);
            tellPeers();
          }
        });
        ws.on('error', () => {});
      });
    });
  }

  ipcMain.handle('lan:start', (_e, device) => start(device));
  ipcMain.on('lan:send', (_e, { to, text }) => {
    for (const [id, ws] of peers) if ((!to || id === to) && ws.readyState === ws.OPEN) ws.send(text);
  });
  ipcMain.handle('lan:stop', () => {
    for (const ws of peers.values()) ws.close(1001, 'stopped');
    peers.clear();
    server?.close();
    server = null;
    info = null;
    tellPeers();
  });
}

module.exports = { setupLan };
