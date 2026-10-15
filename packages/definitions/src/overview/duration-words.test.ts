import { describe, expect, it } from 'vitest';

import { durationInWords } from '../index.ts';

describe('a duration in words', () => {
  it('names each unit it holds, from days down to seconds, and counts one of a unit as one', () => {
    expect([
      durationInWords(604_800_000),
      durationInWords(3_600_000),
      durationInWords(5_400_000),
      durationInWords(60_000),
      durationInWords(90_061_000),
      durationInWords(1_000_000_000_000),
    ]).toEqual([
      '7 days',
      '1 hour',
      '1 hour and 30 minutes',
      '1 minute',
      '1 day, 1 hour, 1 minute, and 1 second',
      '11,574 days, 1 hour, 46 minutes, and 40 seconds',
    ]);
  });

  it('says a fraction of a second only under a minute, and a minute or more to its nearest second', () => {
    expect([
      durationInWords(1000),
      durationInWords(30_500),
      durationInWords(59_999),
      durationInWords(1.6),
      durationInWords(59_999.6),
      durationInWords(90_500),
      durationInWords(90_061_001),
    ]).toEqual([
      '1 second',
      '30.5 seconds',
      '59.999 seconds',
      '0.002 seconds',
      '1 minute',
      '1 minute and 31 seconds',
      '1 day, 1 hour, 1 minute, and 1 second',
    ]);
  });

  it('says that no time is 0 seconds', () => {
    expect([durationInWords(0), durationInWords(-5), durationInWords(0.4)]).toEqual([
      '0 seconds',
      '0 seconds',
      '0 seconds',
    ]);
  });
});
