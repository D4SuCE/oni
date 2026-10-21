// "Daylist": a mix for the current part of the day that changes on its own as the day goes
// on (Spotify's daylist). Each part of the day has a character, expressed as My Wave
// settings (morning: waking up, energetic; night: falling asleep, calm), and the tracks
// the user plays at that time of day take a growing share as this app's play log fills up.

import type { Track } from '../api/types.ts';
import type { RecentPlay } from '../player/recent.ts';
import { DAY, spreadArtists, trackGenre, weightedOrder } from './util.ts';

export type Slot = 'morning' | 'day' | 'evening' | 'night' | 'late';

/** Start hours, in order; "night" runs past midnight. */
const SLOTS: [Slot, number][] = [
  ['late', 1],
  ['morning', 5],
  ['day', 11],
  ['evening', 17],
  ['night', 21],
];

/** My Wave seeds that give each part of the day its character. */
export const SLOT_SEEDS: Record<Slot, string[]> = {
  morning: ['activity:wake-up', 'settingMoodEnergy:active'],
  day: ['activity:work-background'],
  evening: ['mood:relaxed', 'settingMoodEnergy:fun'],
  night: ['mood:relaxed', 'settingMoodEnergy:calm'],
  late: ['activity:fall-asleep', 'settingMoodEnergy:calm'],
};

export interface SlotSpan {
  slot: Slot;
  /** ms epoch, local time */
  start: number;
  end: number;
}

const hourOf = (hours: number) => ((hours % 24) + 24) % 24;

/** The part of the day `at` falls in, with its local start and end. */
export function slotAt(at: number): SlotSpan {
  const d = new Date(at);
  const h = d.getHours();
  // The last slot that started at or before this hour; before 1:00 it is still last night.
  let i = SLOTS.length - 1;
  while (i >= 0 && SLOTS[i][1] > h) i--;
  const startDay = new Date(d);
  startDay.setHours(0, 0, 0, 0);
  if (i < 0) {
    i = SLOTS.length - 1;
    startDay.setDate(startDay.getDate() - 1);
  }
  const start = new Date(startDay);
  start.setHours(SLOTS[i][1]);
  const [, nextHour] = SLOTS[(i + 1) % SLOTS.length];
  const end = new Date(start);
  end.setHours(nextHour);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { slot: SLOTS[i][0], start: start.getTime(), end: end.getTime() };
}

/** Whether a local hour belongs to a slot. */
export function inSlot(hour: number, slot: Slot): boolean {
  const i = SLOTS.findIndex(([s]) => s === slot);
  const from = SLOTS[i][1];
  const to = SLOTS[(i + 1) % SLOTS.length][1];
  const h = hourOf(hour);
  return from < to ? h >= from && h < to : h >= from || h < to;
}

export interface SlotTrack {
  track: Track;
  /** Plays in this part of the day. */
  plays: number;
}

/**
 * What the user plays at this time of day: plays from the app's log in the same slot
 * (any day within `days`), skipped and disliked tracks left out; most played first.
 */
export function playedInSlot(
  plays: RecentPlay[],
  slot: Slot,
  ctx: { now: number; disliked: Set<string>; skipped: (id: string) => boolean },
  days = 60,
): SlotTrack[] {
  const byId = new Map<string, SlotTrack>();
  for (const p of plays) {
    if (ctx.now - p.at > days * DAY || !inSlot(new Date(p.at).getHours(), slot)) continue;
    const id = String(p.track.id);
    if (ctx.disliked.has(id) || ctx.skipped(id) || p.track.available === false) continue;
    const cur = byId.get(id);
    if (cur) cur.plays++;
    else byId.set(id, { track: p.track, plays: 1 });
  }
  return [...byId.values()].sort((a, b) => b.plays - a.plays);
}

/**
 * How much of the daylist comes from the user's own plays at this time of day: nothing
 * without a log, growing with the number of plays in the slot, at most half.
 */
export function personalShare(slotPlays: number): number {
  return Math.min(0.5, slotPlays / 80);
}

/**
 * The daylist: the user's own tracks for this time of day (their share by `personalShare`,
 * picked by plays, not always the same) and wave tracks for the rest. No duplicates,
 * nothing disliked, artists kept apart.
 */
export function assembleDaylist(
  own: SlotTrack[],
  wave: Track[],
  ctx: { disliked: Set<string>; rand: () => number },
  size = 30,
): Track[] {
  const slotPlays = own.reduce((n, x) => n + x.plays, 0);
  const ownCount = Math.min(own.length, Math.round(size * personalShare(slotPlays)));
  const seen = new Set<string>();
  const take = (t: Track) => {
    const id = String(t.id);
    if (seen.has(id) || ctx.disliked.has(id) || t.available === false) return false;
    seen.add(id);
    return true;
  };
  const mine = weightedOrder(own, (x) => x.plays, ctx.rand)
    .map((x) => x.track)
    .filter(take)
    .slice(0, ownCount);
  const fresh = wave.filter(take).slice(0, size - mine.length);
  // Own tracks spread through the list, not bunched at the top.
  return spreadArtists(weightedOrder([...mine, ...fresh], () => 1, ctx.rand));
}

/** The most common genres of the tracks, for the subtitle. */
export function topGenres(tracks: Track[], n = 2): string[] {
  const count = new Map<string, number>();
  for (const t of tracks) {
    const g = trackGenre(t);
    if (g) count.set(g, (count.get(g) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([g]) => g);
}
