// "Add all to mine" and "Download" of a friend's playlist while they run, by key: their progress,
// and a press then stops them after the track under way, as a list's Download does (the user,
// 27.10.2026: neither could be stopped). Kept outside the page: left and come back to, it still
// shows them.

import { create } from 'zustand';

export const useJobs = create<Record<string, { done: number; total: number }>>(() => ({}));
const stopping = new Set<string>();

/** Stops the job `key` after the track under way. */
export function stopJob(key: string) {
  if (useJobs.getState()[key]) stopping.add(key);
}

/** `step` on each track in turn; false when stopped before the end. */
export async function runJob<T>(key: string, list: T[], step: (x: T) => Promise<void>) {
  useJobs.setState({ [key]: { done: 0, total: list.length } });
  try {
    for (const [i, x] of list.entries()) {
      if (stopping.has(key)) return false;
      await step(x);
      useJobs.setState({ [key]: { done: i + 1, total: list.length } });
    }
    return true;
  } finally {
    stopping.delete(key);
    useJobs.setState((s) => {
      const { [key]: _, ...rest } = s;
      return rest;
    }, true);
  }
}
