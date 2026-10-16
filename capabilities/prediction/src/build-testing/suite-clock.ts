import { Clock, Effect } from 'effect';

import { periodOfMoment } from '../periods/moments.ts';

export const startedAt = Date.parse('2026-10-12T09:00:00.000Z');

export const today = periodOfMoment('day', startedAt);

const nanosecondsInAMillisecond = 1_000_000n;

export function clockRunningFrom(moment: number): Clock.Clock {
  const real = Clock.Clock.defaultValue();
  const shift = moment - real.currentTimeMillisUnsafe();
  const millis = () => real.currentTimeMillisUnsafe() + shift;
  const nanos = () => real.currentTimeNanosUnsafe() + BigInt(shift) * nanosecondsInAMillisecond;
  const monotonic = () => real.monotonicTimeNanosUnsafe();
  return {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: monotonic,
    monotonicTimeNanos: Effect.sync(monotonic),
    sleep: real.sleep.bind(real),
  };
}
