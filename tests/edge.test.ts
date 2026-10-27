// Offline tests of the edges (27.10.2026, the user: "think up some more tests"): an upload the Disk
// failed sent again (src/sync/disk.ts), "Add all to mine" and "Download" stopped (src/share/jobs.ts),
// the key a page knows its list playing by, times, Russian plurals, file names, the hidden mark.
// Run: npm run test:edge
import { setLang, tr } from '../src/i18n.ts';
import { listKeyOf } from '../src/player/source.ts';
import { runJob, stopJob, useJobs } from '../src/share/jobs.ts';
import { readMark, visible, withMark } from '../src/share/mark.ts';
import { fileName } from '../src/share/shared.ts';
import { YandexDisk } from '../src/sync/disk.ts';
import { fmtTime } from '../src/ui/util.ts';

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

/** The Disk answering each upload in turn from `answers` (an error's text, or "ok"); the links it was given. */
function fakeUploads(answers: string[]) {
  const links: string[] = [];
  let streams = 0;
  const disk = new YandexDisk({ platform: 'node', request: async () => ({ ok: false, status: 0, data: null }) } as any);
  disk.uploadFrom = async (_path: string, url: string) => {
    links.push(url);
    const a = answers[links.length - 1] ?? 'ok';
    if (a !== 'ok') throw new Error(a);
  };
  const send = () => disk.uploadFresh('shared/1.mp3', async () => `https://stream/${++streams}`);
  return { links, send };
}

const tick = () => new Promise((ok) => setTimeout(ok, 0));

await test('an upload the Disk failed is sent again with a fresh link, until it goes', async () => {
  const { links, send } = fakeUploads(['Yandex Disk upload: failed', 'Yandex Disk upload: failed', 'ok']);
  await send();
  assert(links.length === 3 && new Set(links).size === 3, `three tries, each its own link: ${links}`);
});

await test('an upload the Disk keeps failing: four tries, then the error', async () => {
  const { links, send } = fakeUploads(Array(10).fill('Yandex Disk upload: failed'));
  const err = await send().then(() => null, (e) => e as Error);
  assert(err && /failed/.test(err.message) && links.length === 4, `gave up after ${links.length}: ${err?.message}`);
});

await test('another error of the Disk (not signed in, no answer) is not tried again', async () => {
  for (const msg of ['Yandex Disk: not authorized', 'Yandex Disk upload: no answer']) {
    const { links, send } = fakeUploads([msg]);
    const err = await send().then(() => null, (e) => e as Error);
    assert(err?.message === msg && links.length === 1, `${msg}: ${links.length} tries`);
  }
});

await test('a job goes through each track in turn, its progress seen while it runs, gone after', async () => {
  const seen: string[] = [];
  const done = await runJob('k1', ['a', 'b', 'c'], async (x) => {
    const j = useJobs.getState().k1;
    seen.push(`${x}:${j.done}/${j.total}`);
  });
  assert(done === true && seen.join() === 'a:0/3,b:1/3,c:2/3', `${done} ${seen}`);
  assert(!('k1' in useJobs.getState()), 'its progress gone');
});

await test('a job stopped: the track under way ends, the rest are not touched, it says so', async () => {
  const ran: string[] = [];
  const job = runJob('k2', ['a', 'b', 'c', 'd'], async (x) => {
    ran.push(x);
    if (x === 'b') {
      stopJob('k2');
      await tick();
    }
  });
  assert((await job) === false && ran.join() === 'a,b', `ran ${ran}`);
  assert(!('k2' in useJobs.getState()), 'its progress gone');
});

await test('a job a track failed in: the error comes out, the job is gone, the next one runs whole', async () => {
  const err = await runJob('k3', [1, 2], async (x) => {
    if (x === 2) throw new Error('boom');
  }).then(() => null, (e) => e as Error);
  assert(err?.message === 'boom' && !('k3' in useJobs.getState()), 'failed and cleared');
  const ran: number[] = [];
  assert((await runJob('k3', [1, 2], async (x) => void ran.push(x))) && ran.join() === '1,2', `again: ${ran}`);
});

await test('Stop pressed with nothing running (the job just ended) does not stop the next one', async () => {
  stopJob('k4');
  const ran: number[] = [];
  const done = await runJob('k4', [1, 2, 3], async (x) => void ran.push(x));
  assert(done && ran.join() === '1,2,3', `ran ${ran}`);
});

await test("the list playing as its page knows it: its own key first, then the playlist's, the album's; a wave none", () => {
  const list = 'share:https://yadi.sk/d/x:5';
  assert(listKeyOf({ kind: 'list', title: 'x', list, from: { playlist: '7:3' } as any }) === list, 'own key');
  assert(listKeyOf({ kind: 'list', title: 'x', from: { playlist: '7:3' } as any }) === 'playlist:7:3', 'playlist');
  assert(listKeyOf({ kind: 'list', title: 'x', from: { album: 0 } as any }) === 'album:0', 'album 0 is an album');
  assert(listKeyOf({ kind: 'list', title: 'x' }) === undefined && listKeyOf({ kind: 'wave' }) === undefined && listKeyOf(null) === undefined, 'none');
});

await test('times: minutes and seconds, hours when there are, nothing odd from a bad number', () => {
  const cases: [number, string][] = [[0, '0:00'], [59.9, '0:59'], [61, '1:01'], [600, '10:00'], [3725, '1:02:05'], [-5, '0:00'], [NaN, '0:00'], [Infinity, '0:00']];
  for (const [s, want] of cases) assert(fmtTime(s) === want, `${s} → ${fmtTime(s)}, not ${want}`);
});

await test('"Adding stopped" in Russian and English: the right word for each number', () => {
  setLang('ru');
  const ru: [number, string][] = [[1, '1 трек загружается'], [3, '3 трека загружаются'], [5, '5 треков загружаются'], [11, '11 треков загружаются'], [21, '21 трек загружается'], [22, '22 трека загружаются'], [112, '112 треков загружаются']];
  for (const [n, want] of ru) assert(tr().shared.addStopped(n, 'Мой') === `Добавление остановлено: ${want} в «Мой»`, tr().shared.addStopped(n, 'Мой'));
  assert(tr().shared.addStopped(0, 'Мой') === 'Добавление остановлено' && tr().shared.adding(2, 9) === 'Добавляется 2 из 9', 'none, progress');
  setLang('en');
  assert(tr().shared.addStopped(1, 'Mine') === 'Adding stopped: 1 track is uploading to "Mine"' && tr().shared.addStopped(4, 'Mine') === 'Adding stopped: 4 tracks are uploading to "Mine"', 'English');
  setLang('ru');
});

await test("\"+ Mine\" file names: what Windows forbids goes, a long name is cut, it still ends in .mp3", () => {
  const t = (title: string, ...artists: string[]) => ({ title, artists: artists.map((name) => ({ name })) }) as any;
  assert(fileName(t('A/B: "C"?', 'X*Y')) === 'X Y - A B C.mp3', fileName(t('A/B: "C"?', 'X*Y')));
  const long = fileName(t('я'.repeat(300), 'Автор'));
  assert(long.endsWith('.mp3') && long.length === 154, `${long.length} characters`);
  assert(fileName(t('Песня.MP3')) === 'Песня.mp3', fileName(t('Песня.MP3')));
});

await test('the hidden mark: a description with lines and emoji kept as it was, the same mark twice the same', () => {
  const text = 'Первая строка\nВторая 🎧 строка';
  const link = 'https://disk.yandex.ru/d/Ab-9_x';
  const once = withMark(text, link);
  assert(readMark(once) === link && visible(once) === text, JSON.stringify(visible(once)));
  assert(withMark(once, link) === once, 'the same mark again changes nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
