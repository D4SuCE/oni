// One-off (25.10.2026): the phone's night of plays lost by the history overwrite (fix/history-overwrite) put
// back into its file on Yandex Disk from Yandex's history, at approximate times (the user's pick). Dry run by
// default; WRITE=1 writes. Run with Oni closed on the phone, after it has the fix; then open Oni there.
// YANDEX_MUSIC_TOKEN=… YANDEX_DISK_TOKEN=… node scripts/restore-night-2026-10-25.mjs
const MH = { Authorization: `OAuth ${process.env.YANDEX_MUSIC_TOKEN}` };
const DH = { Authorization: `OAuth ${process.env.YANDEX_DISK_TOKEN}` };
const PHONE = 'device-8d31ecdf5f784da4aaeb5a6a86d53bcf.json';
const PC = 'device-c39ad26ac73942f9af8f498b202de83c.json';
const retry = async (f) => { for (let i = 0; ; i++) try { return await f(); } catch (e) { if (i > 4) throw e; await new Promise((r) => setTimeout(r, 2000)); } };
const ym = (p) => retry(async () => (await (await fetch(`https://api.music.yandex.net${p}`, { headers: MH })).json()).result);
const read = (n) => retry(async () => { const href = (await (await fetch(`https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent('app:/' + n)}`, { headers: DH })).json()).href; return (await fetch(href)).json(); });
const fmt = (ms) => new Date(ms).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
const phone = await read(PHONE);
const pc = await read(PC);
const from = Math.max(...phone.recent.map((p) => p.at)); // the phone's last kept play (24.10 21:15)
const h = await ym('/music-history?fullModelsCount=0');
const known = new Set([...phone.recent, ...pc.recent].filter((p) => p.at > from - 3600e3).map((p) => String(p.track.id)));
const groups = [];
for (const tab of h.historyTabs) {
  if (!['2026-10-24', '2026-10-25'].includes(tab.date)) continue;
  for (const item of tab.items) groups.push({ date: tab.date, context: item.context, ids: item.tracks.map((x) => String(x.data.itemId.trackId)) });
}
for (const g of groups) console.log(g.date, JSON.stringify(g.context).slice(0, 120), g.ids.length, 'tracks,', g.ids.filter((i) => !known.has(i)).length, 'not in Oni');

// The night: My Wave · sad on 25.10, newest first as Yandex lists it.
const night = groups.find((g) => g.date === '2026-10-25' && JSON.stringify(g.context).includes('settingMoodEnergy:sad'));
const tracks = [];
for (let i = 0; i < night.ids.length; i += 50) tracks.push(...(await retry(async () => (await (await fetch('https://api.music.yandex.net/tracks', { method: 'POST', headers: { ...MH, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `track-ids=${night.ids.slice(i, i + 50).join(',')}` })).json()).result)));
const byId = new Map(tracks.map((t) => [String(t.id), t]));
const lastLog = phone.log.plays.filter((p) => !p.r).reduce((m, p) => Math.max(m, p.at), 0);
const trim = (t) => ({ id: String(t.id), title: t.title, version: t.version, durationMs: t.durationMs, artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name, various: a.various })), albums: (t.albums || []).slice(0, 1).map((a) => ({ id: a.id, title: a.title, genre: a.genre, coverUri: a.coverUri, artists: [] })), coverUri: t.coverUri, ogImage: t.ogImage, available: t.available, contentWarning: t.contentWarning, lyricsInfo: t.lyricsInfo, backgroundVideoUri: t.backgroundVideoUri, r128: t.r128 });
const card = (t) => ({ id: String(t.id), title: t.title, version: t.version, durationMs: t.durationMs, artists: (t.artists || []).map((a) => ({ id: a.id, name: a.name })), albums: (t.albums || []).slice(0, 1).map((a) => ({ id: a.id, title: a.title, genre: a.genre, coverUri: a.coverUri, artists: [] })), coverUri: t.coverUri, available: t.available });
// Yandex lists them oldest first (the last, Muni Long, is the phone's 07:21 play): newest first here, the
// newest starting at 07:21, each earlier one ending where the next began.
const newestFirst = [...night.ids].reverse();
let end = lastLog + ((byId.get(newestFirst[0])?.durationMs) || 180000);
const plays = [];
for (const id of newestFirst) {
  const t = byId.get(id);
  if (!t) continue;
  const at = end - (t.durationMs || 180000);
  plays.push({ t, at });
  end = at;
}
console.log(`night: ${plays.length} tracks, ${fmt(plays.at(-1).at)} … ${fmt(plays[0].at)}`);
for (const p of plays.slice(0, 3)) console.log('  ', fmt(p.at), p.t.artists.map((a) => a.name).join(', '), '—', p.t.title);
console.log('   …');
for (const p of plays.slice(-2)) console.log('  ', fmt(p.at), p.t.artists.map((a) => a.name).join(', '), '—', p.t.title);

if (process.env.WRITE === '1') {
  const fresh = await read(PHONE); // the newest, read again just before writing
  const have = new Set(fresh.recent.map((p) => `${p.track.id}@${p.at}`));
  const label = { key: 'myWave', picks: { mood: 'sad' } };
  for (const { t, at } of plays) {
    if (!have.has(`${t.id}@${at}`)) fresh.recent.push({ track: trim(t), at, source: 'Моя волна', label });
    if (!fresh.log.plays.some((p) => p.id === String(t.id) && p.at === at)) fresh.log.plays.push({ id: String(t.id), at, s: Math.round((t.durationMs || 0) / 1000) });
    fresh.log.tracks[String(t.id)] = card(t);
    const e = (fresh.history[String(t.id)] ??= { plays: 0, skips: 0, last: 0 });
    e.plays = Math.max(e.plays, 1);
    e.last = Math.max(e.last, at);
  }
  fresh.recent.sort((a, b) => b.at - a.at);
  fresh.recent = fresh.recent.slice(0, 500);
  fresh.log.plays.sort((a, b) => a.at - b.at);
  fresh.at = Date.now();
  const up = await (await fetch(`https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent('app:/' + PHONE)}&overwrite=true`, { headers: DH })).json();
  const r = await fetch(up.href, { method: 'PUT', body: JSON.stringify(fresh) });
  console.log('written', r.status, 'recent', fresh.recent.length);
}
