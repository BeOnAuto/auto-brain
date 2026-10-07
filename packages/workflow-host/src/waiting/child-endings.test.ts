import { Conflict } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, at, recorded } from '../reaction-testing/brain-writes.ts';
import { eventually } from '../testing/eventually.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { recordedWaiting, resultOfEnding } from '../waiting-testing/recorded-waiting.ts';
import { parentId, parentRun, waitingParent } from '../waiting-testing/waiting-parent.ts';
import { childEndings, endedChildrenOn } from './child-endings.ts';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const calledBy = { execution_id: parentId, reference: '/do/0/ask', run: 1 };

const ofTheChild = { primitive: 'orchestration', name: 'check', spec_version: 1, by: 'brain:alpha', at };

const succeeded = { type: 'execution_succeeded', output: 'checked', record: {}, ...ofTheChild, called_by: calledBy };

const endingRecord = {
  brain: { org: 'acme', brain: 'alpha' },
  brainKey: alpha,
  record: {
    id: 'record-1',
    cursor: 'record-1',
    causationId: null,
    correlationId: null,
    stream: `executions/${child}`,
    version: 2,
    type: succeeded.type,
    data: succeeded,
    recordedAt: at,
  },
};

describe('the ending of a run that answers a call', () => {
  it('is delivered by the follower to the step that waits for it, as its answer, and the call is answered', async () => {
    const { database, settled, answeredCalls } = await waitingParent(child);

    await recorded(database.store, `${alpha}executions/${child}`, succeeded);

    expect(await settled(parentId)).toEqual({ status: 'succeeded', output: 'checked' });
    expect(await answeredCalls()).toEqual([{ state: 'answered', delivered: 1 }]);
  });

  it('is a receipt and no failure when it reaches a call that is closed, as when it is delivered again', async () => {
    const mapped: string[] = [];
    const waiting = recordedWaiting();
    const { database, hosted, settled } = await waitingParent(child, {
      waiting: {
        ...waiting.options,
        resultOf: (ending) => {
          mapped.push(ending.type);
          return resultOfEnding(ending);
        },
      },
    });

    await recorded(database.store, `${alpha}executions/${child}`, succeeded);
    await recorded(database.store, `${alpha}executions/${child}`, succeeded);
    await recorded(database.store, `${alpha}executions/${child}x`, {
      type: 'execution_failed',
      ...ofTheChild,
      called_by: calledBy,
    });
    await settled(parentId);
    await eventually(
      (): readonly string[] => mapped,
      (types) => types.includes('execution_failed'),
    );

    expect(mapped).toContain('execution_failed');
    expect(hosted.troubles()).toEqual([]);
  });
});

describe('a delivery of an ending that the run cannot take now', () => {
  it('fails, to be made again, by a consumer that never skips a delivery', async () => {
    const { database } = await waitingParent(child);
    const consumer = childEndings({
      database,
      submitted: () => Effect.fail(new Conflict({ detail: 'The log of the run kept changing' })),
      resultOf: resultOfEnding,
      now: () => 1,
    });

    const { deliveries } = await Effect.runPromise(consumer.batchOf(endingRecord, undefined, 100));
    const failure = await Effect.runPromise(Effect.flip(Effect.forEach(deliveries, ({ deliver }) => deliver)));
    const skipped = consumer.skipped(endingRecord, { key: 'call', workflow: parentId, deliver: Effect.void }, '');
    const resumed = await Effect.runPromise(consumer.batchOf(endingRecord, 'call', 100));

    expect([failure.detail, consumer.skippedAfterSweeps]).toEqual(['The log of the run kept changing', Infinity]);
    expect(resumed.deliveries).toEqual([]);
    expect(await Effect.runPromise(Effect.as(skipped, 'nothing skipped'))).toBe('nothing skipped');
  });
});

describe('the endings of the runs a run waits for, before a timer of that run fires', () => {
  it('are delivered first, so a child that ended while the server was down answers before the deadline', async () => {
    const { database, callStates } = await waitingParent(child);
    await recorded(database.store, `${alpha}executions/${child}`, {
      type: 'execution_started',
      ...ofTheChild,
      input: {},
    });
    const submitted: unknown[] = [];
    const endedChildren = endedChildrenOn({
      database,
      submitted: (input) =>
        Effect.sync(() => {
          submitted.push(input);
          return { outcome: 'applied', version: 2 };
        }),
      resultOf: resultOfEnding,
      now: () => 1,
    });

    await Effect.runPromise(endedChildren(parentRun));
    const whileGoing = submitted.length;
    await recorded(database.store, `${alpha}executions/${child}`, {
      type: 'execution_rejected',
      rejection: { reason: 'cancelled', detail: 'Expired', kind: 'deadline' },
      ...ofTheChild,
      called_by: calledBy,
    });
    await Effect.runPromise(endedChildren(parentRun));

    expect(whileGoing).toBe(0);
    expect(submitted).toEqual([
      {
        kind: 'call_answered',
        executionId: parentRun,
        at: 1,
        key: { executionId: parentRun, reference: '/do/0/ask', run: 1 },
        result: { status: 'rejected', reason: 'cancelled', detail: 'Expired' },
      },
    ]);
    expect(await callStates()).toEqual([{ state: 'answered', delivered: 1 }]);
  });
});

describe('the endings of the runs a run waits for, when its calls cannot be read', () => {
  it('fail the fire of its timer, so the timer fires again at the next sweep', async () => {
    const { database } = await waitingParent(child);
    const reading = faultyDatabase(database);
    reading.failing(true);
    const endedChildren = endedChildrenOn({
      database: reading,
      submitted: () => Effect.die(new Error('Nothing is submitted')),
      resultOf: resultOfEnding,
      now: () => 1,
    });

    expect(await Effect.runPromise(Effect.flip(endedChildren(parentRun)))).toMatchObject({
      detail: 'The database was told to fail',
    });
  });
});
