// Offline unit tests for Yandex Disk (src/sync/disk.ts) over a fake network: a file sent to an
// upload server that does not answer (seen through a VPN, 27.10.2026: 2 of 12 small files) goes
// again through another one, instead of the whole round failing with "no answer".
// Run: npm run test:disk
import type { HttpRequest, Transport } from '../src/api/transport.ts';
import { DiskAuthError, YandexDisk } from '../src/sync/disk.ts';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.stack || e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** The Disk's API hands out upload links to servers 1, 2, …; `server(n)` says what server n does. */
function fakeNet(server: (n: number, req: HttpRequest) => Promise<{ status: number }>) {
  let links = 0;
  const sent: number[] = [];
  const transport = {
    async request(req: HttpRequest) {
      if (req.url.endsWith('/resources/upload')) return { ok: true, status: 200, data: { href: `https://uploader${++links}.disk/put` } };
      const n = Number(/uploader(\d+)/.exec(req.url)?.[1]);
      sent.push(n);
      const r = await server(n, req);
      return { ok: r.status < 300, status: r.status, data: '' };
    },
  } as unknown as Transport;
  return { transport, sent, links: () => links };
}

const never = () => new Promise<never>(() => {});

await test('a file goes through another upload server when the first does not answer', async () => {
  const net = fakeNet((n) => (n === 1 ? never() : Promise.resolve({ status: 201 })));
  await new YandexDisk(net.transport, 50).write('index.json', '{}');
  assert(net.sent.join() === '1,2', `sent to ${net.sent}`);
});

await test('a file goes through another upload server when the first cannot be reached', async () => {
  const net = fakeNet((n) => (n === 1 ? Promise.reject(new TypeError('fetch failed')) : Promise.resolve({ status: 201 })));
  await new YandexDisk(net.transport, 50).write('index.json', '{}');
  assert(net.sent.join() === '1,2', `sent to ${net.sent}`);
});

await test('three servers in a row not answering: "no answer", and no more tries', async () => {
  const net = fakeNet(() => never());
  const e = await new YandexDisk(net.transport, 30).write('index.json', '{}').then(() => null, (x) => x);
  assert(/no answer/.test(e?.message), `error: ${e}`);
  assert(net.sent.length === 3, `tries: ${net.sent.length}`);
});

await test('a refusal (not a silence) is not tried again', async () => {
  const net = fakeNet(() => Promise.resolve({ status: 507 }));
  const e = await new YandexDisk(net.transport, 50).write('index.json', '{}').then(() => null, (x) => x);
  assert(/HTTP 507/.test(e?.message), `error: ${e}`);
  assert(net.sent.length === 1, `tries: ${net.sent.length}`);
});

await test('the token refused: not tried again either', async () => {
  const transport = { request: async () => ({ ok: false, status: 401, data: {} }) } as unknown as Transport;
  const e = await new YandexDisk(transport, 50).write('index.json', '{}').then(() => null, (x) => x);
  assert(e instanceof DiskAuthError, `error: ${e}`);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
