// Discord status (Rich Presence, stage 7): what plays in Oni shows on the user's Discord profile,
// "Listening to Oni" with the track, its artists, cover and time. Discord's desktop app takes it
// over its local IPC pipe (\\?\pipe\discord-ipc-N): frames of [op: int32 LE][length: int32 LE][JSON],
// a handshake (op 0) with the application's id, then SET_ACTIVITY commands (op 1). No library:
// this little is all Oni needs. With Discord closed it tries again now and then; on a pause the
// status goes, as Spotify's does. Settings → Window turns it off.
const net = require('node:net');

/** The user's Discord application "Oni" (discord.com/developers, 22.10.2026). Not a secret. */
const CLIENT_ID = '1562889548793516082';
/** The mask, from the public releases repository (an uploaded asset would need a name in Discord's portal). */
const ICON = 'https://raw.githubusercontent.com/D4SuCE/oni-releases/main/assets/logo.png';
/** Tests run a pipe of their own. */
const PIPE = process.env.ONI_DISCORD_PIPE || '\\\\?\\pipe\\discord-ipc-';
const RETRY = 15_000;
/** Discord takes at most 5 updates in 20 s: changes closer than this are sent as one. */
const SETTLE = 1500;

let socket = null;
/** A connection on its way (one at a time: a second, started meanwhile, doubled every update). */
let connecting = false;
let ready = false;
let enabled = true;
/** The activity wanted now (null: none), and the last one sent. */
let wanted = null;
let sent;
let retryTimer = null;
let sendTimer = null;
let nonce = 0;
let log = () => {};

function frame(op, payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function close() {
  ready = false;
  sent = undefined;
  if (socket) socket.destroy();
  socket = null;
}

function later() {
  if (retryTimer || !enabled) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, RETRY);
  retryTimer.unref?.();
}

/** Tries the pipes Discord may have opened (0…9), the first that answers. */
function connect(n = 0) {
  if (!enabled || (n === 0 && (socket || connecting))) return;
  if (n > 9) {
    connecting = false;
    return later();
  }
  connecting = true;
  const s = net.connect(PIPE + n);
  let buffer = Buffer.alloc(0);
  s.once('error', () => {
    if (socket === s) {
      close();
      later();
    } else connect(n + 1);
  });
  s.on('connect', () => {
    connecting = false;
    socket = s;
    s.write(frame(0, { v: 1, client_id: CLIENT_ID }));
  });
  s.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      const op = buffer.readInt32LE(0);
      const len = buffer.readInt32LE(4);
      if (buffer.length < 8 + len) break;
      let msg = null;
      try {
        msg = JSON.parse(buffer.subarray(8, 8 + len).toString());
      } catch {
        /* a frame we cannot read: skipped */
      }
      buffer = buffer.subarray(8 + len);
      if (process.env.ONI_DISCORD_DEBUG) log('info', `discord ← ${op} ${JSON.stringify(msg).slice(0, 600)}`);
      if (op === 1 && msg?.evt === 'READY') {
        ready = true;
        log('info', 'discord: connected');
        flush();
      } else if (op === 1 && msg?.evt === 'ERROR') log('warn', `discord: ${msg.data?.message}`);
      // Accepted: Discord answers with the activity as it shows it.
      else if (op === 1 && msg?.cmd === 'SET_ACTIVITY') log('info', `discord: ${msg.data ? `showing "${msg.data.details ?? ''}"` : 'cleared'}`);
      else if (op === 2) {
        // Closed by Discord (a wrong id, or it is quitting).
        log('warn', `discord: closed (${msg?.message})`);
        close();
        later();
      } else if (op === 3) s.write(frame(4, msg)); // ping → pong
    }
  });
  s.on('close', () => {
    if (socket !== s) return;
    close();
    later();
  });
}

function flush() {
  if (!ready || !socket) return;
  const key = JSON.stringify(wanted);
  if (key === sent) return;
  sent = key;
  socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, ...(wanted ? { activity: wanted } : {}) }, nonce: String(++nonce) }));
}

function schedule() {
  if (sendTimer) return;
  sendTimer = setTimeout(() => {
    sendTimer = null;
    flush();
  }, SETTLE);
}

/**
 * What plays (from the page): { title, artists, album, cover, url, start, end } in ms epoch, or
 * null when nothing plays (paused, stopped). Long texts are cut to Discord's 128.
 */
function setTrack(track) {
  const cut = (s) => (s && s.length > 128 ? `${s.slice(0, 127)}…` : s || undefined);
  wanted = track
    ? {
        type: 2, // "Listening to"
        status_display_type: 2, // the track's title in the member list, not "Oni"
        details: cut(track.title),
        state: cut(track.artists),
        timestamps: track.start && track.end ? { start: Math.round(track.start), end: Math.round(track.end) } : undefined,
        assets: {
          large_image: track.cover || ICON,
          large_text: cut(track.album),
          small_image: track.cover ? ICON : undefined,
          small_text: track.cover ? 'Oni' : undefined,
        },
        buttons: track.url ? [{ label: 'Открыть в Яндекс Музыке', url: track.url }] : undefined,
        instance: false,
      }
    : null;
  if (!socket) connect();
  schedule();
}

function setEnabled(on) {
  enabled = Boolean(on);
  if (enabled) {
    connect();
    schedule();
    return;
  }
  // Off: the status goes at once, and the pipe is let go.
  if (ready && socket) socket.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: String(++nonce) }));
  clearTimeout(retryTimer);
  retryTimer = null;
  setTimeout(close, 300);
}

function init(logger, on) {
  log = logger;
  enabled = on !== false;
  if (enabled) connect();
}

module.exports = { init, setTrack, setEnabled };
