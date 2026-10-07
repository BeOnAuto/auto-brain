import { recordedReaderOf } from '@beonauto/ledger';
import { Conflict, messageIdOf } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, at, recorded } from '../reaction-testing/brain-writes.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { followedHost } from '../waiting-testing/followed-host.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { cancelRequests, startGraceMs } from './cancel-requests.ts';

const executionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

function askedOf(primitive: string) {
  return {
    type: 'execution_cancel_requested',
    kind: 'requested',
    reason: 'Not needed any more',
    primitive,
    name: 'pause',
    spec_version: 1,
    by: 'acme-admin',
    at,
  };
}

const requestStream = `${alpha}executions/${executionId}`;

const requestId = messageIdOf(requestStream, 1);

describe('a cancel request on a workflow run', () => {
  it('is given to the run, which ends cancelled by who asked, its record caused by the request', async () => {
    const { database, hosted, settled } = await followedHost();
    hosted.know(executionId);
    await Effect.runPromise(hosted.host.start(runAt(executionId), startOf(pausing)));

    await recorded(database.store, requestStream, askedOf('orchestration'), {
      causationId: null,
      correlationId: executionId,
    });
    const settlement = await settled(executionId);
    const { records } = await Effect.runPromise(
      recordedReaderOf(database.store)(
        { org: 'acme', brain: 'alpha' },
        { kind: 'run', execution: executionId },
        { order: 'desc', limit: 1, dataOf: [] },
      ),
    );

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: 'requested',
      detail: 'Not needed any more',
      by: 'acme-admin',
    });
    expect(records[0]).toMatchObject({ stream: `${alpha}runs/${executionId}`, causationId: requestId });
  });
});

describe('a cancel request on a run of another capability', () => {
  it('is handed to the capability’s cancel, caused by the request', async () => {
    const waiting = recordedWaiting();
    const { database } = await followedHost({ waiting: waiting.options });

    await recorded(database.store, requestStream, askedOf('interaction'), {
      causationId: null,
      correlationId: 'root-1',
    });
    await Effect.runPromise(Effect.sleep(300));

    expect(waiting.deferredCancels()).toEqual([
      {
        execution: { org: 'acme', brain: 'alpha', id: executionId },
        request: { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        lineage: { causationId: requestId, correlationId: 'root-1' },
      },
    ]);
  });
});

describe('a cancel request on a workflow run whose start never reached the host', () => {
  it('waits for the start for a minute, then settles the run as cancelled, so a later start answers settled', async () => {
    const late = await followedHost({ clock: movedClock(Date.now() + startGraceMs + 60_000) });
    const early = await followedHost();
    late.hosted.know(executionId);
    early.hosted.know(executionId);

    await recorded(early.database.store, requestStream, askedOf('orchestration'));
    await recorded(late.database.store, requestStream, askedOf('orchestration'));
    const settlement = await late.settled(executionId);
    const started = await Effect.runPromise(late.hosted.host.start(runAt(executionId), startOf(pausing)));

    expect(settlement).toMatchObject({ status: 'rejected', reason: 'cancelled', by: 'acme-admin' });
    expect(started).toBe('settled');
    expect(early.hosted.settlements().get(executionId)).toBeUndefined();
  });
});

describe('the consumer of cancel requests', () => {
  it('never skips a request, and fails a delivery the run cannot take now, to be made again', async () => {
    const { database } = await followedHost();
    const consumer = cancelRequests({
      database,
      submitted: () => Effect.fail(new Conflict({ detail: 'The log of the run kept changing' })),
      settle: () => Effect.die(new Error('Nothing is settled')),
      cancelDeferred: () => Effect.void,
      workflows: 'orchestration',
      now: Date.now,
    });
    const asked = {
      brain: { org: 'acme', brain: 'alpha' },
      brainKey: alpha,
      record: {
        id: requestId,
        cursor: 'c',
        causationId: null,
        correlationId: null,
        stream: `executions/${executionId}`,
        version: 1,
        type: 'execution_cancel_requested',
        data: askedOf('orchestration'),
        recordedAt: at,
      },
    };

    const { deliveries } = await Effect.runPromise(consumer.batchOf(asked, undefined, 100));
    const failure = await Effect.runPromise(Effect.flip(Effect.forEach(deliveries, ({ deliver }) => deliver)));
    const skipped = consumer.skipped(asked, { key: 'cancel', workflow: 'pause', deliver: Effect.void }, '');
    const resumed = await Effect.runPromise(consumer.batchOf(asked, 'cancel', 100));

    expect([failure.detail, consumer.skippedAfterSweeps]).toEqual(['The log of the run kept changing', Infinity]);
    expect(resumed.deliveries).toEqual([]);
    expect(await Effect.runPromise(Effect.as(skipped, 'nothing skipped'))).toBe('nothing skipped');
  });
});
