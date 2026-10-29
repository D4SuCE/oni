// Listening together on the home network (docs/together.md, src/together/): the PC of the one who
// started listens, the guests' devices connect to it; the room's number from the invitation is the
// key, a connection without it is closed. A guest's PC connects from here (the page may not open a
// plain ws:// one: its Content-Security-Policy). The page makes the sense of the messages; here
// they are only carried, and the server passes each on to everyone else.

const { ipcMain } = require('electron');
const { WebSocket, WebSocketServer } = require('ws');
const { addresses, sameKey } = require('./lan.cjs');

const HELLO_WITHIN = 5000;
const PING_EVERY = 20_000;

function setupTogether(window, { testMode, writeLog }) {
  let server = null;
  let info = null;
  let key = null;
  let me = null;
  /** Connected to this one (it listens), by device id. */
  const guests = new Map();
  /** This one's connections to another (a guest), by that device's id. */
  const hosts = new Map();

  const toPage = (channel, data) => {
    const w = window();
    if (w && !w.isDestroyed()) w.webContents.send(channel, data);
  };
  const tellPeers = () => toPage('tog:peers', [...guests.keys()]);

  function keepAlive(ws) {
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_EVERY);
    ws.on('pong', () => (alive = true));
    ws.on('close', () => clearInterval(ping));
  }

  function serve(newKey, device) {
    me = device;
    // Another room: the old one's guests go.
    if (info && key !== newKey) stop();
    key = newKey;
    if (info) return Promise.resolve(info);
    return new Promise((resolve) => {
      server = new WebSocketServer({ host: testMode ? '127.0.0.1' : '0.0.0.0', port: 0, maxPayload: 4 * 1024 * 1024 });
      server.on('error', (e) => {
        writeLog('warn', 'together', `server: ${e.message}`);
        resolve(null);
      });
      server.on('listening', () => {
        info = { port: server.address().port, hosts: testMode ? ['127.0.0.1'] : addresses() };
        resolve(info);
      });
      server.on('connection', (ws) => {
        let id = null;
        const hello = setTimeout(() => !id && ws.close(4001, 'no key'), HELLO_WITHIN);
        keepAlive(ws);
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
            guests.get(id)?.close(4002, 'replaced');
            guests.set(id, ws);
            ws.send(JSON.stringify({ t: 'welcome', device: me }));
            tellPeers();
            return;
          }
          toPage('tog:message', { from: id, text });
        });
        ws.on('close', () => {
          clearTimeout(hello);
          if (id && guests.get(id) === ws) {
            guests.delete(id);
            tellPeers();
          }
        });
        ws.on('error', () => {});
      });
    });
  }

  function stop() {
    for (const ws of guests.values()) ws.close(1001, 'stopped');
    guests.clear();
    server?.close();
    server = null;
    info = null;
    key = null;
    tellPeers();
  }

  /** A guest connects to `url`; resolves once welcomed. */
  function connect({ id, url, hello }) {
    hosts.get(id)?.terminate();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 2500, maxPayload: 4 * 1024 * 1024 });
      hosts.set(id, ws);
      let welcomed = false;
      const timer = setTimeout(() => !welcomed && (ws.terminate(), reject(new Error('no answer'))), 3000);
      ws.on('open', () => ws.send(hello));
      ws.on('message', (raw, binary) => {
        if (binary) return;
        const text = raw.toString();
        if (!welcomed) {
          if (!text.includes('"welcome"')) return ws.terminate();
          welcomed = true;
          clearTimeout(timer);
          keepAlive(ws);
          return resolve();
        }
        toPage('tog:message', { from: id, text });
      });
      ws.on('close', () => {
        clearTimeout(timer);
        if (hosts.get(id) === ws) hosts.delete(id);
        if (welcomed) toPage('tog:closed', id);
        else reject(new Error('closed'));
      });
      ws.on('error', () => {});
    });
  }

  ipcMain.handle('tog:serve', (_e, { key: k, device }) => serve(k, device));
  ipcMain.handle('tog:serve:stop', () => stop());
  ipcMain.handle('tog:connect', (_e, o) => connect(o));
  ipcMain.handle('tog:close', (_e, id) => {
    hosts.get(id)?.close(1000, 'left');
    hosts.delete(id);
  });
  ipcMain.on('tog:send', (_e, { to, text }) => {
    const send = (ws) => ws.readyState === ws.OPEN && ws.send(text);
    if (to && hosts.has(to)) return send(hosts.get(to));
    for (const [id, ws] of guests) if (!to || id === to) send(ws);
  });
}

module.exports = { setupTogether };
