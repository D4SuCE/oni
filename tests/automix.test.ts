// Offline tests for the DJ-like transition (src/player/automix.ts, src/player/beatGrid.ts): the beat
// grid of a drum loop, where the voice is by the lyrics, and the plan of the crossing — by the voice
// for tracks that differ, by the beat for steady ones of near tempo. Measured on real songs too
// (6.11.2026, six chart tracks: a tail decoded from its own bytes sits exactly where the whole file's
// does; steady grids 4.5–11 ms off their line, a drummer-less intro has none).
// Run: npm run test:automix
import { beatGrid, type Grid } from '../src/player/beatGrid.ts';
import { plan, SETTLE, steady, stretch, voiceOf } from '../src/player/automix.ts';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL ${name}: ${e?.message || e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const RATE = 11025;
/** `seconds` of a drum loop at `bpm`: a kick (a falling low tone) on each beat from `first` s, a
 * hi-hat (noise) between, and a quiet pad under it all. */
function loop(bpm: number, seconds: number, first = 0.25, seed = 1) {
  const out = new Float32Array(Math.round(seconds * RATE));
  let r = seed;
  const noise = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const period = 60 / bpm;
  for (let i = 0; i < out.length; i++) out[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  for (let t = first; t < seconds; t += period) {
    const at = Math.round(t * RATE);
    for (let i = 0; i < 0.15 * RATE && at + i < out.length; i++) {
      const e = Math.exp(-i / (0.04 * RATE));
      out[at + i] += 0.8 * e * Math.sin((2 * Math.PI * (60 + 90 * Math.exp(-i / (0.01 * RATE))) * i) / RATE);
    }
    const hat = Math.round((t + period / 2) * RATE);
    for (let i = 0; i < 0.03 * RATE && hat + i < out.length; i++) out[hat + i] += 0.2 * Math.exp(-i / (0.005 * RATE)) * noise();
  }
  return out;
}

const grid = (bpm: number, anchor: number, wobble = 0.005, onLine = 0.95): Grid => ({ bpm, period: 60 / bpm, beats: [], anchor, wobble, clarity: 0.8, onLine });

test('a drum loop: its tempo to 0.1 BPM, its beats on the kicks within 15 ms', () => {
  for (const bpm of [92, 124, 128, 140, 174]) {
    const g = beatGrid(loop(bpm, 40, 0.25), RATE);
    assert(g, `${bpm}: no grid`);
    // 174 may be read as half time (87): a beat either way lies on a kick.
    const folded = Math.abs(g.bpm - bpm) < Math.abs(g.bpm * 2 - bpm) ? g.bpm : g.bpm * 2;
    assert(near(folded, bpm, 0.1), `${bpm}: read ${g.bpm.toFixed(2)}`);
    const k = Math.round((0.25 - g.anchor) / g.period);
    assert(near(g.anchor + k * g.period, 0.25, 0.015), `${bpm}: beat at ${(g.anchor + k * g.period).toFixed(3)}, kick at 0.25`);
    assert(steady(g), `${bpm}: not steady (wobble ${(g.wobble * 1000).toFixed(1)} ms, on line ${g.onLine.toFixed(2)})`);
  }
});

test('no beat (a held pad): nothing steady to lay beats on', () => {
  const pad = new Float32Array(40 * RATE).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE));
  assert(!steady(beatGrid(pad, RATE)), 'a pad taken for a beat');
});

test('the voice by the lyrics: the first line, and the last one\'s end as the lyrics tab fills it', () => {
  const v = voiceOf({ synced: true, text: '[00:12.00]Hello there\n[00:15.00]One more line\n[00:20.00]\n[02:30.00]The last words\n' }, 200);
  assert(v && v.first === 12, `first ${v?.first}`);
  // "The last words": 3 syllables, 0.45 s each, up to the end: 1.35 s.
  assert(v && near(v.last, 151.35, 0.01), `last ${v?.last}`);
  assert(voiceOf({ synced: true, text: '[00:01.00]\n[00:03.00]♪\n' }, 100) === null, 'no words: not an instrumental');
  assert(voiceOf({ synced: false, text: 'Hello' }, 100) === undefined, 'plain text: no times, nothing known');
});

const out = { duration: 200, end: 199, rate: 1 };

test('the plain crossfade where nothing is known, and where the voices are apart already', () => {
  const p = plan(out, { lead: 0 }, 6);
  assert(p.at === 193 && p.fade === 6 && !p.sync, JSON.stringify(p));
  const apart = plan({ ...out, voice: { first: 10, last: 180 } }, { lead: 0, voice: { first: 20, last: 150 } }, 6);
  assert(apart.at === 193 && apart.fade === 6, JSON.stringify(apart));
});

test('by the voice: the next one comes later, shorter, when its singing would meet this one\'s', () => {
  // This one sings to 196 s; the next one starts singing 1 s in: from 193 they would overlap.
  const p = plan({ ...out, voice: { first: 10, last: 196 } }, { lead: 0, voice: { first: 1, last: 150 } }, 6);
  assert(near(p.at, 195.3, 1e-9) && near(p.fade, 3.7, 1e-9), JSON.stringify(p));
  // Singing to the very end, the next one singing at once: the shortest crossing, at the end.
  const q = plan({ ...out, voice: { first: 10, last: 199 } }, { lead: 0, voice: { first: 0.2, last: 150 } }, 6);
  assert(near(q.fade, 1.5, 1e-9) && near(q.at, 197.5, 1e-9), JSON.stringify(q));
});

test('tempi: near ones are matched (also by halving or doubling), far ones are not', () => {
  assert(near(stretch(grid(124, 0), grid(128, 0))!, 124 / 128, 1e-9), '124 → 128');
  assert(near(stretch(grid(128, 0), grid(64.5, 0))!, 64 / 64.5, 1e-9), 'half time');
  assert(stretch(grid(100, 0), grid(128, 0)) === null, '100 → 128 matched');
});

test('by the beat: the next one\'s first beat on a bar of this one\'s, at this one\'s tempo, silent while it settles', () => {
  // This one: 125 BPM (0.48 s), beats from 0.1 s; its music ends at 199 s. The next one: 128 BPM, first beat at 0.5 s.
  const a = grid(125, 0.1);
  const b = grid(128, 0.5);
  const p = plan({ ...out, grid: a, voice: { first: 10, last: 180 } }, { lead: 0.3, grid: b, voice: { first: 30, last: 150 } }, 6);
  assert(p.sync, `not matched: ${p.why}`);
  const rate = b.period / a.period;
  assert(near(p.sync.rate, rate, 1e-9), `rate ${p.sync.rate}`);
  // Its beat lies on one of this one's, a whole number of bars before this one's last beat.
  const lastK = Math.floor((199 - 0.1) / 0.48);
  const k = Math.round((p.sync.on - 0.1) / 0.48);
  assert(near(p.sync.on, 0.1 + k * 0.48, 1e-9) && (lastK - k) % 4 === 0, `on ${p.sync.on}, beat ${k} of ${lastK}`);
  assert(p.sync.to === 0.5, `to ${p.sync.to}`);
  // Started early enough to reach that beat at that rate, from SETTLE s before its sound.
  assert(near(p.at + (p.sync.to - p.from) / rate, p.sync.on, 1e-9), JSON.stringify(p));
  assert(near(p.from, Math.max(0, 0.3 - SETTLE * rate), 1e-9), `from ${p.from}`);
  // No singing in this one's last 16 beats: the long crossing (an outro under an intro).
  assert(lastK - k === 16, `${lastK - k} beats`);
  // Silent while it settles, then heard to this one's end.
  assert(near(p.sync.quiet, SETTLE, 1e-9), `quiet ${p.sync.quiet}`);
  assert(near(p.at + p.sync.quiet + p.fade, 199, 1e-9), `fade ${p.fade}`);
});

test('by the beat, with singing near the end: 8 beats, and still no two voices at once', () => {
  const a = grid(125, 0.1);
  const b = grid(126, 0.5);
  const p = plan({ ...out, grid: a, voice: { first: 10, last: 196 } }, { lead: 0, grid: b, voice: { first: 2, last: 150 } }, 3);
  assert(p.sync, p.why);
  const voiceIn = p.sync.on + (2 - p.sync.to) / p.sync.rate;
  assert(voiceIn >= 196.3, `the next voice at ${voiceIn.toFixed(2)}, this one sings to 196`);
});

test('a wobbly grid on either side, or the speed changed: by the voice only', () => {
  const steadyA = grid(125, 0.1);
  assert(!plan({ ...out, grid: steadyA }, { lead: 0, grid: grid(126, 0.5, 0.06) }, 6).sync, 'a wobbly next one matched');
  assert(!plan({ ...out, grid: grid(125, 0.1, 0.005, 0.3) }, { lead: 0, grid: grid(126, 0.5) }, 6).sync, 'a sparse grid matched');
  assert(!plan({ ...out, rate: 1.25, grid: steadyA }, { lead: 0, grid: grid(126, 0.5) }, 6).sync, 'matched at 1.25×');
});

const jump = { mix: true, jump: true };

test('to the words: a long wordless end and start left out, the next words a breath after the last', () => {
  // This one's words end at 150 s of 199; the next one sings from 40 s.
  const p = plan({ ...out, voice: { first: 10, last: 150 } }, { lead: 0, voice: { first: 40, last: 150 } }, 6, jump);
  assert(near(p.from, 36, 1e-9), `from ${p.from}`);
  // Its words at 150.6 s of this one's time: started 4 s before.
  assert(near(p.at, 146.6, 1e-9), `at ${p.at}`);
  assert(near(p.at + (40 - p.from), 150.6, 1e-9), 'the next words not a breath after the last');
  // This one stays at its level to its last word, then fades; the next one comes in up to its words.
  assert(near(p.hold!, 3.4, 1e-9) && near(p.fadeIn!, 4, 1e-9) && near(p.fade, 5, 1e-9), JSON.stringify(p));
});

test("to the words: singing to its end, only the next one's long start is skipped, no voices together", () => {
  const p = plan({ ...out, voice: { first: 10, last: 197 } }, { lead: 0, voice: { first: 40, last: 150 } }, 6, jump);
  assert(near(p.from, 36, 1e-9), `from ${p.from}`);
  assert(p.at + 4 >= 197 + 0.6 - 1e-9 && p.at < 199, `at ${p.at}`);
});

test('to the words: short starts and ends, or the singing not known — as without it', () => {
  const short = plan({ ...out, voice: { first: 10, last: 195 } }, { lead: 0, voice: { first: 5, last: 150 } }, 6, jump);
  assert(short.at === 193 && short.from === 0 && !short.hold, JSON.stringify(short));
  const unknown = plan(out, { lead: 0, voice: { first: 40, last: 150 } }, 6, jump);
  assert(unknown.at === 193 && unknown.from === 0, JSON.stringify(unknown));
  const instrumental = plan({ ...out, voice: null }, { lead: 0, voice: { first: 40, last: 150 } }, 6, jump);
  assert(instrumental.at === 193, JSON.stringify(instrumental));
});

test("to the words, steady beats of a near tempo: the next one starts on its beat two bars before its words, on this one's beat", () => {
  const a = grid(125, 0.1);
  const b = grid(126, 0.5);
  const p = plan({ ...out, grid: a, voice: { first: 10, last: 150 } }, { lead: 0, grid: b, voice: { first: 40, last: 150 } }, 6, jump);
  assert(p.sync, p.why);
  // Its start beat: 8 of its beats before its words, on its grid.
  const k = (p.sync.to - 0.5) / b.period;
  assert(near(k, Math.round(k), 1e-6) && near(40 - p.sync.to, 8 * b.period, b.period / 2 + 1e-9), `to ${p.sync.to}`);
  // Laid on a beat of this one's, its words not over this one's last.
  const kk = (p.sync.on - 0.1) / a.period;
  assert(near(kk, Math.round(kk), 1e-6), `on ${p.sync.on}`);
  assert(p.sync.on + (40 - p.sync.to) / p.sync.rate >= 150.3, 'the next words over the last ones');
  assert(near(p.at + (p.sync.to - p.from) / p.sync.rate, p.sync.on, 1e-9), JSON.stringify(p));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
