import { Effect } from 'effect';

import type { HostClock } from '../loop/host-clock.ts';

export interface MovedClock extends HostClock {
  readonly moveTo: (at: number) => void;
}

const aBreath = 5;

export function movedClock(start: number): MovedClock {
  const time = { now: start };
  return {
    now: () => time.now,
    sleep: (milliseconds) => Effect.sleep(Math.min(milliseconds, aBreath)),
    moveTo: (at) => {
      time.now = at;
    },
  };
}
