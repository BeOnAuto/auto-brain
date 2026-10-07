import type { ArmTimer, WorkflowEngine } from '@beonauto/workflow-engine';
import { Effect, Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { skippingClock, systemClock, type HostClock } from '../loop/host-clock.ts';
import { startLoop } from '../loop/host-loop.ts';
import { eventually } from '../testing/eventually.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { sqlTimers } from '../timers/sql-timers.ts';
import { dueAwaitedMs, dueInOneTick, duePerformedAtOnce } from './due-work.ts';
import { fakeDueWork, type FakeDueWork } from './fake-due-work.ts';

const runId = 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const engine: WorkflowEngine = {
  submit: () => Effect.die(new Error('The loop submits through the host')),
  wake: () => Effect.die(new Error('The loop wakes runs through a sweep')),
  sweep: () => Effect.succeed({ runs: 0, timersArmedAgain: 0 }),
};

interface DueLooping {
  readonly order: () => readonly string[];
  readonly troubles: () => readonly string[];
  readonly armTimer: (dueAt: number, timerId?: string) => Promise<void>;
}

async function dueLooping(
  rows: FakeDueWork,
  clock: HostClock = systemClock,
  sweepEveryMs = 3_600_000,
): Promise<DueLooping> {
  const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
  const order: string[] = [];
  const troubles: string[] = [];
  const alarm: { armed: (dueAt: number) => void } = { armed: Function.constVoid };
  const timers = sqlTimers(database, (dueAt) => {
    alarm.armed(dueAt);
  });
  const trouble = (what: string) =>
    Effect.sync(() => {
      troubles.push(what);
    });
  const loop = startLoop({
    clock,
    timers,
    dueWork: [rows.work('host')],
    engine,
    fire: ({ timerId }) => Effect.sync(() => order.push(`timer ${timerId} after ${rows.performed().length} rows`)),
    resume: () => Effect.succeed(0),
    trouble,
    sweepEveryMs,
  });
  alarm.armed = loop.armed;
  onTestFinished(() => loop.stop());
  return {
    order: () => order,
    troubles: () => troubles,
    armTimer: async (dueAt, timerId = '1') => {
      const timer: ArmTimer = { kind: 'arm_timer', executionId: runId, timerId, dueAt, purpose: 'wait' };
      await Effect.runPromise(
        timers.timers.arm(timer, { executionId: runId, attributes: {} }, { version: 1, lastStep: null }),
      );
    },
  };
}

function rowsDueBy(count: number, dueAt: number): FakeDueWork {
  const rows = fakeDueWork(1);
  for (const key of Array.from({ length: count }, (_, index) => `row-${index}`)) {
    rows.add(key, dueAt);
  }
  return rows;
}

describe('the due rows of a projection, in the loop of the host', () => {
  it('are performed before the timers of the same tick, at most 256 a tick and 16 at once, the rest at once after', async () => {
    const now = Date.now();
    const rows = rowsDueBy(300, now - 1000);
    const looping = await dueLooping(rows, skippingClock(now));

    await looping.armTimer(now - 1000);
    await eventually(rows.performed, (performed) => performed.length === 300);

    expect(looping.order()).toEqual([`timer 1 after ${dueInOneTick} rows`]);
    expect([rows.mostAtOnce(), new Set(rows.performed().map(({ at }) => at)).size]).toEqual([duePerformedAtOnce, 1]);
  });

  it('wake the loop when the next of them is due', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('later', now + 90_000);

    await dueLooping(rows, skippingClock(now));
    const [performed] = await eventually(rows.performed, (done) => done.length > 0);

    expect(performed).toEqual({ key: 'later', at: now + 90_000, by: 'host' });
  });
});

describe('due rows whose perform never ends, as a delivery to a receiver that never answers', () => {
  it('hold the timers of a tick for a second at most, and the ticks after not at all, 16 of them at once', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of Array.from({ length: 20 }, (_, index) => `hanging-${index}`)) {
      rows.add(key, now - 1000);
      rows.hanging(key);
    }
    const looping = await dueLooping(rows);

    await looping.armTimer(now - 1000);
    await eventually(looping.order, (order) => order.length === 1);
    const firstFiredAt = Date.now();
    const secondDueAt = Date.now() + 300;
    await looping.armTimer(secondDueAt, '2');
    await eventually(looping.order, (order) => order.length === 2);

    expect(firstFiredAt - now).toBeLessThan(dueAwaitedMs + 3000);
    expect(Date.now() - secondDueAt).toBeLessThan(dueAwaitedMs);
    expect(looping.order()).toEqual(['timer 1 after 0 rows', 'timer 2 after 0 rows']);
    expect([rows.attempts().length, rows.mostAtOnce()]).toEqual([duePerformedAtOnce, duePerformedAtOnce]);
  });
});

describe('a due row that cannot be performed', () => {
  it('is tried again after a wait that doubles, without holding the rows due after it', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    rows.add('stuck', now);
    rows.failing('stuck');
    rows.add('next', now + 1500);

    const looping = await dueLooping(rows, skippingClock(now));
    const attempts = await eventually(rows.attempts, (made) => made.length >= 6);

    expect(attempts.slice(0, 6).map(({ key, at }) => [key, at - now])).toEqual([
      ['stuck', 0],
      ['stuck', 1000],
      ['next', 1500],
      ['stuck', 3000],
      ['stuck', 7000],
      ['stuck', 15_000],
    ]);
    expect(new Set(looping.troubles())).toEqual(
      new Set(['A due row of the fake rows could not be performed; the loop tries it again after a wait']),
    );
  });
});

describe('due rows that cannot be read', () => {
  it('are reported, and performed once the reads come back', async () => {
    const rows = rowsDueBy(1, Date.now());
    rows.failReads(2);

    const looping = await dueLooping(rows, systemClock, 20);
    const performed = await eventually(rows.performed, (done) => done.length > 0);

    expect([performed.length, new Set(looping.troubles())]).toEqual([
      1,
      new Set([
        'The due rows of the fake rows could not be read; the loop tries again',
        'The next due time of the fake rows could not be read; the loop waits for the next sweep',
      ]),
    ]);
  });
});
