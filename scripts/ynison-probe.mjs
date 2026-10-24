// Ynison, first look (ROADMAP, "Автопилот" 8): connect under the account, read what plays where
// (track, position, devices), and leave. Nothing is changed: the probe joins as a shadow device
// (is_shadow, as the official desktop app does by default), never active, and its own state is
// versions are random, as the official app makes them, with no time: older than anything the server keeps.
//
//   YANDEX_MUSIC_TOKEN=… node scripts/ynison-probe.mjs [seconds to listen, default 5]
//
// YNISON_LOCAL_ADDRESS=192.168.0.100 (the network card's own address) sends everything past a VPN
// that works as a network adapter (Happ's TUN): Windows sends a socket bound to an address out of
// that address's own adapter.
//
// How the official app connects (its app.asar, 5.124): a WebSocket to the redirector, then to the
// host it names; the device, the ticket and the OAuth token go in the third subprotocol, as JSON.

import { randomUUID, randomBytes } from 'node:crypto';
import https from 'node:https';
import { Agent, WebSocket as UndiciWebSocket, fetch as undiciFetch } from 'undici';

const token = process.env.YANDEX_MUSIC_TOKEN;
if (!token) {
  console.error('YANDEX_MUSIC_TOKEN is not set');
  process.exit(1);
}
const listen = Number(process.argv[2] || 5) * 1000;
const localAddress = process.env.YNISON_LOCAL_ADDRESS || undefined;
const dispatcher = localAddress ? new Agent({ localAddress }) : undefined;
const fetch = (url, init) => (dispatcher ? undiciFetch(url, { ...init, dispatcher }) : globalThis.fetch(url, init));
const WebSocket = dispatcher ? UndiciWebSocket : globalThis.WebSocket;
if (localAddress) console.log(`past the VPN: from ${localAddress}, out as ${await (await fetch('https://ifconfig.co/json')).json().then((j) => `${j.ip}, ${j.country}`)}`);
const t0 = Date.now();
const log = (what) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(2)} s: ${what}`);
// The account's number, as the official app sends it (X-Yandex-Music-Multi-Auth-User-Id).
const uid = (await (await fetch('https://api.music.yandex.net/account/status', { headers: { Authorization: `OAuth ${token}` } })).json()).result?.account?.uid;
const deviceId = randomBytes(8).toString('hex');
const info = { app_name: 'Oni', app_version: 'probe', type: 1 };

const protocols = (extra) => ['Bearer', 'v2', encodeURIComponent(JSON.stringify({
  'Ynison-Device-Id': deviceId,
  'Ynison-Device-Info': JSON.stringify(info),
  authorization: `OAuth ${token}`,
  ...(uid ? { 'X-Yandex-Music-Multi-Auth-User-Id': String(uid) } : {}),
  ...extra,
}))];

/** When a socket fails with no word: the same handshake by hand, to see what the server answered. */
function handshake(url, extra) {
  const u = new URL(url.replace(/^wss:/, 'https:'));
  return new Promise((resolve) => {
    const req = https.request({ host: u.host, path: u.pathname, localAddress, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Protocol': protocols(extra).join(', '), Origin: 'https://music.yandex.ru' } });
    req.setTimeout(15000, () => { req.destroy(); resolve('no answer in 15 s'); });
    req.on('upgrade', (r, socket) => { socket.destroy(); resolve(`101, protocol ${r.headers['sec-websocket-protocol']}`); });
    req.on('response', (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(`HTTP ${r.statusCode} ${JSON.stringify(r.headers)} ${b.slice(0, 400)}`)); });
    req.on('error', (e) => resolve(`error ${e.code || ''} ${e.message}`));
    req.end();
  });
}

/** The hub by hand (when the built-in client fails with no word): send the first message in a
 * frame of our own and print every frame the server sends back for a few seconds. */
function byHand(url, extra, message) {
  const u = new URL(url.replace(/^wss:/, 'https:'));
  return new Promise((resolve) => {
    const req = https.request({ host: u.host, path: u.pathname, localAddress, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
      'Sec-WebSocket-Protocol': protocols(extra).join(', '), Origin: 'https://music.yandex.ru' } });
    req.on('response', (r) => { log(`by hand: HTTP ${r.statusCode}`); resolve(); });
    req.on('error', (e) => { log(`by hand: error ${e.code || ''} ${e.message}`); resolve(); });
    req.on('upgrade', (r, socket, head) => {
      log(`by hand: 101 (${JSON.stringify(r.headers)})`);
      const body = Buffer.from(JSON.stringify(message));
      const mask = randomBytes(4);
      const len = body.length < 126 ? Buffer.from([0x80 | body.length]) : body.length < 65536
        ? Buffer.from([0x80 | 126, body.length >> 8, body.length & 255]) : null;
      const masked = Buffer.from(body.map((b, i) => b ^ mask[i % 4]));
      socket.write(Buffer.concat([Buffer.from([0x81]), len, mask, masked]));
      log(`by hand: sent ${body.length} bytes`);
      let buf = head;
      const take = () => {
        while (buf.length >= 2) {
          const op = buf[0] & 15;
          let n = buf[1] & 127, at = 2;
          if (n === 126) { n = buf.readUInt16BE(2); at = 4; } else if (n === 127) { n = Number(buf.readBigUInt64BE(2)); at = 10; }
          if (buf.length < at + n) return;
          const data = buf.subarray(at, at + n);
          buf = buf.subarray(at + n);
          if (op === 8) log(`by hand: close frame ${data.length >= 2 ? data.readUInt16BE(0) : ''} ${data.subarray(2).toString()}`);
          else log(`by hand: frame op ${op}, ${n} bytes: ${data.toString().slice(0, 600)}`);
        }
      };
      socket.on('data', (d) => { buf = Buffer.concat([buf, d]); take(); });
      socket.on('end', () => log('by hand: the server ended the connection'));
      socket.on('close', (hadError) => { log(`by hand: closed${hadError ? ' with an error' : ''}`); resolve(); });
      socket.on('error', (e) => log(`by hand: socket error ${e.code || ''} ${e.message}`));
      setTimeout(() => { socket.destroy(); resolve(); }, 8000);
    });
    req.end();
  });
}

function open(url, extra, onOpen) {
  return new Promise((resolve, reject) => {
    // Without the site's Origin the server answers 403 (a page of Oni's own origin would get it too).
    const ws = new WebSocket(url, { protocols: protocols(extra), headers: { Origin: 'https://music.yandex.ru' }, dispatcher });
    const messages = [];
    let sent = false;
    ws.addEventListener('open', () => { log(`open ${url.split('/')[2]}`); sent = Boolean(onOpen); onOpen?.(ws); });
    ws.addEventListener('message', (e) => {
      const data = JSON.parse(String(e.data));
      if (data.error) return reject(Object.assign(new Error(`Ynison error${sent ? ' (after our first message)' : ''}`), { data }));
      messages.push(data);
      resolve({ ws, messages });
    });
    ws.addEventListener('error', (e) => { log(`error ${e.message || e.error?.message || ''}`); reject(e.error ?? new Error('socket error')); });
    ws.addEventListener('close', (e) => { log(`close ${e.code} ${e.reason || ''} clean ${e.wasClean}`); if (!messages.length) reject(new Error(`closed ${e.code} ${e.reason}`)); });
  });
}

const version = () => ({ device_id: deviceId, version: Math.floor(Math.random() * 2 ** 53), timestamp_ms: 0 });
const hello = {
  update_full_state: {
    player_state: {
      player_queue: {
        current_playable_index: -1, entity_id: '', entity_type: 'VARIOUS', playable_list: [],
        options: { repeat_mode: 'NONE' }, entity_context: 'BASED_ON_ENTITY_BY_DEFAULT', version: version(), from_optional: '',
      },
      status: { duration_ms: 0, paused: true, playback_speed: 1, progress_ms: 0, version: version() },
    },
    device: {
      capabilities: { can_be_player: true, can_be_remote_controller: false, volume_granularity: 16 },
      info: { device_id: deviceId, type: 'WEB', title: 'Oni (проверка)', app_name: 'Oni', app_version: 'probe' },
      volume_info: { volume: 0 },
      is_shadow: true,
    },
    is_currently_active: false,
  },
  rid: randomUUID(),
  player_action_timestamp_ms: 0,
  activity_interception_type: 'DO_NOT_INTERCEPT_BY_DEFAULT',
};

async function trackName(id) {
  const r = await fetch(`https://api.music.yandex.net/tracks/${encodeURIComponent(id)}`, { headers: { Authorization: `OAuth ${token}` } });
  const t = (await r.json()).result?.[0];
  return t ? `${t.artists?.map((a) => a.name).join(', ')} — ${t.title}` : `(track ${id})`;
}

const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

async function show(state, at) {
  const queue = state.player_state?.player_queue;
  const status = state.player_state?.status;
  const playing = queue?.playable_list?.[queue.current_playable_index];
  const active = state.active_device_id_optional;
  console.log(`\n[${((at - t0) / 1000).toFixed(1)} s]`);
  console.log('devices:');
  for (const d of state.devices ?? []) {
    const i = d.info ?? {};
    console.log(`  ${i.device_id === active ? '▶' : ' '} ${i.title || '?'} (${i.type}, ${i.app_name} ${i.app_version})${d.is_shadow ? ' shadow' : ''}${i.device_id === deviceId ? ' — this probe' : ''}`);
  }
  if (!playing) return console.log('playing: nothing in the queue');
  // The progress was the device's at the status's timestamp; on since then while not paused.
  const since = status.paused ? 0 : Math.max(0, Date.now() - Number(status.version?.timestamp_ms || Date.now()));
  console.log(`playing: ${await trackName(playing.playable_id)} [${playing.playable_type}, from ${playing.from || '?'}]`);
  console.log(`  ${status.paused ? 'paused' : 'playing'} at ${mmss(Number(status.progress_ms) + since)} of ${mmss(Number(status.duration_ms))}`);
  console.log(`  queue: ${queue.entity_type} ${queue.entity_id || ''}, ${queue.current_playable_index + 1} of ${queue.playable_list.length}`);
}

const redirectorUrl = 'wss://ynison.music.yandex.ru/redirector.YnisonRedirectService/GetRedirectToYnison';
const redirect = (await open(redirectorUrl, {}).catch(async (e) => {
  console.log(`redirector: ${e.message}${e.data ? ` ${JSON.stringify(e.data)}` : ''}`);
  console.log(`redirector handshake by hand: ${await handshake(redirectorUrl, {})}`);
  process.exit(1);
})).messages[0];
redirect.ws?.close?.();
console.log(`redirected to ${redirect.host} (session ${String(redirect.session_id).slice(0, 6)}…)`);
const hubUrl = `wss://${redirect.host}/ynison_state.YnisonStateService/PutYnisonState`;
const ticket = { 'Ynison-Redirect-Ticket': redirect.redirect_ticket, 'Ynison-Session-Id': redirect.session_id };
const hub = await open(hubUrl, ticket, (ws) => ws.send(JSON.stringify(hello))).catch(async (e) => {
  console.log(`hub: ${e.message}${e.data ? ` ${JSON.stringify(e.data)}` : ''}${e.cause ? ` (${e.cause})` : ''}`);
  // A fresh ticket for the by-hand try (the first one may be spent).
  const again = await open(redirectorUrl, {}).then((r) => r.messages[0]).catch(() => redirect);
  await byHand(`wss://${again.host}/ynison_state.YnisonStateService/PutYnisonState`,
    { 'Ynison-Redirect-Ticket': again.redirect_ticket, 'Ynison-Session-Id': again.session_id }, hello);
  process.exit(1);
});
await show(hub.messages[0], Date.now());
hub.ws.addEventListener('message', (e) => show(JSON.parse(String(e.data)), Date.now()));
setTimeout(() => {
  hub.ws.close();
  process.exit(0);
}, listen);
