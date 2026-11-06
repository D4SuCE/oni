// "Today in Oni: N" in Settings → About (the user, 6.11.2026: "let everyone see how many of us use
// the app — not who downloaded it, who came in, say, in a day"). Oni has no server of its own: the
// `stats` release in D4SuCE/oni-releases holds a tiny file for each day (day-YYYY-MM-DD, UTC; laid
// out a day ahead by its stats workflow), each device downloads today's once a day, and GitHub's
// download count of it is how many devices opened Oni that day. Read back from GitHub's API. Nothing
// else goes: no account, no tracks, no id. Devices, not people (a PC and a phone are two). Not in the
// test runs; not at all with "Don't count me".

import { create } from 'zustand';
import { storage, transport } from '../api/client.ts';

const FILES = 'https://github.com/D4SuCE/oni-releases/releases/download/stats/';
const RELEASE = 'https://api.github.com/repos/D4SuCE/oni-releases/releases/tags/stats';
/** The UTC day this device was last counted; "Don't count me"; the last counts read (and when). */
const COUNTED = 'stats.day';
const OFF = 'stats.off';
const KEPT = 'stats.counts';
/** The counts are read again after this long at most (GitHub's API: 60 an hour without a token). */
const FRESH = 10 * 60 * 1000;

const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

type Counts = { today: number | null; yesterday: number | null; day: string; at: number };

function kept(): Counts | null {
  try {
    const v = JSON.parse(storage.getItem(KEPT) || 'null') as Counts | null;
    return v && v.day === day() ? v : null;
  } catch {
    return null;
  }
}

export const useUsers = create<{ today: number | null; yesterday: number | null; off: boolean }>(() => ({
  today: kept()?.today ?? null,
  yesterday: kept()?.yesterday ?? null,
  off: storage.getItem(OFF) === '1',
}));

let reading: Promise<void> | null = null;

/** Today's and yesterday's counts from GitHub (kept for a few minutes). */
export function readCount(force = false): Promise<void> {
  const k = kept();
  if (!force && k && Date.now() - k.at < FRESH) return Promise.resolve();
  reading ??= transport
    .request<{ assets?: { name: string; download_count: number }[] }>({ url: RELEASE, headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => {
      if (!r.ok || !Array.isArray(r.data.assets)) return;
      const of = (d: string) => r.data.assets!.find((a) => a.name === `day-${d}`)?.download_count ?? null;
      const counts: Counts = { today: of(day()), yesterday: of(day(Date.now() - 86_400_000)), day: day(), at: Date.now() };
      storage.setItem(KEPT, JSON.stringify(counts));
      useUsers.setState({ today: counts.today, yesterday: counts.yesterday });
    })
    .catch(() => {})
    .finally(() => (reading = null));
  return reading;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Once a day (UTC): today's file, a while after the start; again next day if Oni stays open. */
export function countMe() {
  if (transport.testMode || timer) return;
  const go = () => {
    timer = null;
    const today = day();
    if (useUsers.getState().off || storage.getItem(COUNTED) === today) return later();
    transport
      .request({ url: `${FILES}day-${today}`, responseType: 'text' })
      .then((r) => {
        // Not laid out yet (the workflow late): tried again in an hour.
        if (!r.ok) return later(60 * 60 * 1000);
        storage.setItem(COUNTED, today);
        void readCount(true);
        later();
      })
      .catch(() => later(60 * 60 * 1000));
  };
  // Next: an hour, or just past the next UTC midnight, whichever comes first.
  const later = (ms?: number) => {
    const toMidnight = 86_400_000 - (Date.now() % 86_400_000) + 60_000;
    timer = setTimeout(go, Math.min(ms ?? toMidnight, toMidnight));
  };
  timer = setTimeout(go, 20_000);
}

/** "Don't count me": not counted from now on (today's count, if made, stays). */
export function setCountOff(off: boolean) {
  storage.setItem(OFF, off ? '1' : '0');
  useUsers.setState({ off });
}
