// The shared clock of a room (docs/together.md): every device asks Yandex's time a few times and
// keeps the answer that came back fastest (its error is at most half that trip); on the home network
// a guest asks the device of the one who started, a trip of milliseconds. Its own clock may be off
// by seconds (Windows sets it once a week): the room's moments are on this one.

/** One question: sent and answered on this device's clock, and the time told (all ms). */
export interface Sample {
  sent: number;
  got: number;
  told: number;
}

/** How far the clock told is ahead of this one (ms), by the fastest answer; null with none. */
export function offsetOf(samples: Sample[]): number | null {
  let best: Sample | null = null;
  for (const s of samples) if (s.got >= s.sent && (!best || s.got - s.sent < best.got - best.sent)) best = s;
  return best ? best.told - (best.sent + best.got) / 2 : null;
}

/** The fastest trip of a set (ms): how far the offset can be off is half of it. */
export const tripOf = (samples: Sample[]) => Math.min(...samples.map((s) => s.got - s.sent));

/** Asks `ask` (a time server) `times` times, a little apart; the samples. */
export async function measure(ask: () => Promise<number>, times = 5, local = () => Date.now()): Promise<Sample[]> {
  const out: Sample[] = [];
  for (let i = 0; i < times; i++) {
    const sent = local();
    try {
      const told = await ask();
      out.push({ sent, got: local(), told });
    } catch {
      /* no answer: the next one */
    }
    if (i < times - 1) await new Promise((ok) => setTimeout(ok, 120));
  }
  return out;
}

export class SharedClock {
  /** Added to this device's clock. */
  offset = 0;
  /** How sure (ms): half the fastest trip; Infinity until measured. */
  error = Infinity;
  private local: () => number;

  constructor(local = () => Date.now()) {
    this.local = local;
  }

  /** Samples from one source: taken if they are surer than what is known (or the known is old). */
  learn(samples: Sample[], force = false) {
    const offset = offsetOf(samples);
    if (offset === null) return false;
    const error = tripOf(samples) / 2;
    if (!force && error > this.error) return false;
    this.offset = offset;
    this.error = error;
    return true;
  }

  get known() {
    return Number.isFinite(this.error);
  }

  now() {
    return this.local() + this.offset;
  }
}
