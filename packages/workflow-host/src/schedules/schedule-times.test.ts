import { describe, expect, it } from 'vitest';

import { cronRejectionOf, latestDue, nextAfter, type Timing } from './schedule-times.ts';

const anchor = Date.parse('2026-10-01T09:00:00.000Z');

const aMinute = 60_000;

function at(text: string): number {
  return Date.parse(text);
}

describe('a cron expression', () => {
  it('has five fields that can be read and name a time that comes', () => {
    expect([
      cronRejectionOf('30 2 * * *'),
      cronRejectionOf('30 2 * *'),
      cronRejectionOf('0 30 2 * * *'),
      cronRejectionOf('61 2 * * *'),
      cronRejectionOf('0 0 30 2 *'),
    ]).toEqual([
      undefined,
      'A cron expression has five fields, minute, hour, day of month, month and day of week, not "30 2 * *"',
      'A cron expression has five fields, minute, hour, day of month, month and day of week, not "0 30 2 * * *"',
      'The cron expression 61 2 * * * cannot be read: CronPattern: Invalid value for minute: 61',
      'The cron expression 0 0 30 2 * names no time that comes',
    ]);
  });
});

describe('the next time a schedule is due', () => {
  it('is the next multiple of its period after its anchor, or the next time its cron names, in UTC', () => {
    expect([
      nextAfter({ kind: 'every', milliseconds: aMinute }, anchor, anchor),
      nextAfter({ kind: 'every', milliseconds: aMinute }, anchor, anchor + 90_000),
      nextAfter({ kind: 'cron', expression: '30 2 * * *' }, anchor, anchor),
      nextAfter({ kind: 'cron', expression: '0 0 30 2 *' }, anchor, anchor),
    ]).toEqual([anchor + aMinute, anchor + 2 * aMinute, at('2026-10-02T02:30:00.000Z'), null]);
  });
});

describe('the latest time a schedule was due', () => {
  it('is the last due time at or before now', () => {
    const every: Timing = { kind: 'every', milliseconds: aMinute };
    const nightly: Timing = { kind: 'cron', expression: '30 2 * * *' };
    const due = at('2026-10-02T02:30:00.000Z');

    expect([
      latestDue(every, anchor, anchor + aMinute, anchor + 5 * aMinute + 10_000),
      latestDue(nightly, anchor, due, due),
      latestDue(nightly, anchor, due, at('2026-10-05T12:00:00.000Z')),
      latestDue(nightly, anchor, due, at('2026-10-05T02:29:59.999Z')),
    ]).toEqual([
      anchor + 5 * aMinute,
      at('2026-10-02T02:30:00.000Z'),
      at('2026-10-05T02:30:00.000Z'),
      at('2026-10-04T02:30:00.000Z'),
    ]);
  });
});
