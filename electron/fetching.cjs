// How long the desktop waits for the network. Nothing limited it: a server that took a request and
// said nothing held it for minutes, the app on its splash screen or the track not starting (through
// a VPN servers do go silent: 27.10.2026, 60 s and more). A request given up comes to the page as "no
// network", which it knows what to do with.

const ANSWER = 20_000;
/** A file from Disk (a device's history, a day's backup) is bigger than an answer of the API. */
const DISK_FILE = 120_000;
const UPLOAD = 600_000;
/** A download goes on as long as it moves: a whole lossless album track on a slow line takes minutes. */
const STALL = 30_000;

function requestLimit(url, hasBody) {
  if (hasBody) return UPLOAD;
  return /(^|\.)disk\.yandex\./.test(new URL(url).hostname) ? DISK_FILE : ANSWER;
}

/** The file behind `url`, whole; given up when nothing has come for `stall` ms. */
async function fetchBytes(url, stall = STALL) {
  const stop = new AbortController();
  let timer;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop.abort(Object.assign(new Error('the download stopped moving'), { name: 'TimeoutError' })), stall);
  };
  alive();
  try {
    const r = await fetch(url, { signal: stop.signal });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { answered: true });
    const parts = [];
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      alive();
    }
    const whole = Buffer.concat(parts);
    return whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestLimit, fetchBytes };
