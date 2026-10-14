import { describe, expect, it } from 'vitest';

import { durationInWords } from '../index.ts';

describe('a duration in words', () => {
  it('names each unit it holds, from days down, and counts one of a unit as one', () => {
    expect([
      durationInWords(604_800_000),
      durationInWords(3_600_000),
      durationInWords(5_400_000),
      durationInWords(90_061_001),
      durationInWords(1_000_000_000_000),
    ]).toEqual([
      '7 days',
      '1 hour',
      '1 hour and 30 minutes',
      '1 day, 1 hour, 1 minute, 1 second, and 1 millisecond',
      '11,574 days, 1 hour, 46 minutes, and 40 seconds',
    ]);
  });

  it('says that no time is 0 seconds, and counts a part of a millisecond as its nearest whole', () => {
    expect([durationInWords(0), durationInWords(-5), durationInWords(1.6)]).toEqual([
      '0 seconds',
      '0 seconds',
      '2 milliseconds',
    ]);
  });
});
