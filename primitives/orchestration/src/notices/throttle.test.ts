import { describe, expect, it } from 'vitest';

import { makeThrottle } from './throttle.ts';

describe('a throttle', () => {
  it('admits the first notice, holds back the rest of its window, and counts them on the next one it admits', () => {
    const throttle = makeThrottle(60_000);

    expect([0, 10_000, 59_999, 60_000, 60_001, 125_000].map((now) => throttle.admit(now))).toStrictEqual([
      { admitted: true, suppressed: 0 },
      { admitted: false },
      { admitted: false },
      { admitted: true, suppressed: 2 },
      { admitted: false },
      { admitted: true, suppressed: 1 },
    ]);
  });
});
