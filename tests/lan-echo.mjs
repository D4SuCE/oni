// A stand-in PC for the iPhone smoke run (.github/workflows/ios.yml, src/ios-smoke.ts, lanLink):
// listens as electron/lan.cjs does, welcomes a hello with the key "smoke", answers "ping" with "pong".
import { WebSocketServer } from 'ws';

const server = new WebSocketServer({ host: '127.0.0.1', port: 47999 });
const at = () => new Date().toISOString().slice(11, 23);
server.on('connection', (ws) => {
  let ok = false;
  console.log(`${at()} connection`);
  ws.on('close', (code) => console.log(`${at()} closed ${code}`));
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    console.log(`${at()} ${msg.t}${msg.t === 'hello' ? ` (key ${msg.key === 'smoke' ? 'right' : 'wrong'})` : ''}`);
    if (!ok) {
      if (msg.t !== 'hello' || msg.key !== 'smoke') return ws.close(4001, 'bad key');
      ok = true;
      return ws.send(JSON.stringify({ t: 'welcome', device: { id: 'mac', platform: 'electron' } }));
    }
    if (msg.t === 'ping') ws.send(JSON.stringify({ t: 'pong' }));
  });
});
console.log('lan-echo on 127.0.0.1:47999');
