import { recordedReaderOf } from '@beonauto/ledger';
import { Conflict, messageIdOf, type Context } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, at, recorded, recordedWith } from '../reaction-testing/brain-writes.ts';
import { eventually } from '../testing/eventually.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { followedHost } from '../waiting-testing/followed-host.ts';
import { recordedWaiting } from '../waiting-testing/recorded-waiting.ts';
import { cancelRequests } from './cancel-requests.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const pausing = workflow('do:\n  - pause: { wait: PT1H }');

const askedToCancel = { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed any more' } };

function runOf(type: string, by = 'acme-admin'): Context {
  return { by, at, definitionType: type, definitionName: 'pause', definitionVersion: 1 };
}

const requestStream = `${alpha}runs/${runId}`;

const requestId = messageIdOf(requestStream, 1);

const started = { type: 'run_started', data: { input: {} } };

const cancelled = {
  status: 'rejected',
  reason: 'cancelled',
  kind: 'requested',
  detail: 'Not needed any more',
  by: 'acme-admin',
};

describe('a cancel request on a workflow run', () => {
  it('is given to the run, which ends cancelled by who asked, its record caused by the request', async () => {
    const { database, hosted, settled } = await followedHost();
    hosted.know(runId);
    await Effect.runPromise(hosted.host.start(runAt(runId), startOf(pausing)));

    await recordedWith(database.store, requestStream, askedToCancel, {
      context: runOf('workflow'),
      lineage: { causationId: null, correlationId: runId },
    });
    const settlement = await settled(runId);
    const { records } = await Effect.runPromise(
      recordedReaderOf(database.store)(
        { org: 'acme', brain: 'alpha' },
        { kind: 'run', run: runId },
        { order: 'desc', limit: 1, dataOf: [] },
      ),
    );

    expect(settlement).toEqual(cancelled);
    expect(records[0]).toMatchObject({ stream: `${alpha}run-logs/${runId}`, causationId: requestId });
  });
});

describe('a cancel request on a run of another capability', () => {
  it('is handed to the capability’s cancel, caused by the request', async () => {
    const waiting = recordedWaiting();
    const { database } = await followedHost({ waiting: waiting.options });

    await recordedWith(database.store, requestStream, askedToCancel, {
      context: runOf('interaction'),
      lineage: { causationId: null, correlationId: 'root-1' },
    });
    const handed = await eventually(waiting.deferredCancels, (cancels) => cancels.length > 0);

    expect(handed).toEqual([
      {
        run: { org: 'acme', brain: 'alpha', id: runId },
        request: { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
        lineage: { causationId: requestId, correlationId: 'root-1' },
      },
    ]);
  });
});

describe('a cancel request recorded before the host started the workflow', () => {
  it('is passed over by the follower, and the start of the run finds it and ends the run cancelled at once', async () => {
    const { database, hosted, settled } = await followedHost();
    hosted.know(runId);
    await recorded(database.store, requestStream, started, runOf('workflow'));
    await recorded(database.store, requestStream, askedToCancel, runOf('workflow'));
    const other = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';
    hosted.know(other);
    await Effect.runPromise(hosted.host.start(runAt(other), startOf(pausing)));
    await recorded(database.store, `${alpha}runs/${other}`, askedToCancel, runOf('workflow'));

    const otherSettled = await settled(other);
    const answer = await Effect.runPromise(hosted.host.start(runAt(runId), startOf(pausing)));
    const settlement = await settled(runId);

    expect([otherSettled, answer, settlement]).toEqual([cancelled, 'started', cancelled]);
    expect(hosted.troubles()).toEqual([]);
  });
});

interface Fact {
  readonly type: string;
  readonly data: unknown;
}

function asked({ type, data }: Fact, context: Context = runOf('workflow')) {
  return {
    brain: { org: 'acme', brain: 'alpha' },
    brainKey: alpha,
    record: {
      id: requestId,
      cursor: 'c',
      causationId: null,
      correlationId: null,
      stream: `runs/${runId}`,
      version: 1,
      globalPosition: 1,
      type,
      data,
      context,
      recordedAt: at,
    },
  };
}

async function failingConsumer() {
  const { database } = await followedHost();
  return cancelRequests({
    database,
    submitted: () => Effect.fail(new Conflict({ detail: 'The log of the run kept changing' })),
    cancelDeferred: () => Effect.void,
    workflows: 'workflow',
    now: Date.now,
  });
}

const endingOfAnotherCapability = { type: 'run_succeeded', data: { output: null, record: {} } };

describe('the consumer of cancel requests', () => {
  it('never skips a request, and fails a delivery the run cannot take now, to be made again', async () => {
    const consumer = await failingConsumer();
    const { deliveries } = await Effect.runPromise(consumer.batchOf(asked(askedToCancel), undefined, 100));
    const failure = await Effect.runPromise(Effect.flip(Effect.forEach(deliveries, ({ deliver }) => deliver)));
    const skipped = consumer.skipped(asked(started), { key: 'cancel', workflow: 'pause', deliver: Effect.void }, '');

    expect([failure.detail, consumer.skippedAfterSweeps]).toEqual(['The log of the run kept changing', Infinity]);
    expect(await Effect.runPromise(Effect.as(skipped, 'nothing skipped'))).toBe('nothing skipped');
  });

  it('makes no delivery of a cancel before a start, nor of a record that is no request or ends another capability’s run', async () => {
    const consumer = await failingConsumer();
    const beforeTheStart = asked(
      { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Gone' } },
      { by: 'brain:alpha', at },
    );
    const batches = await Effect.runPromise(
      Effect.all([
        consumer.batchOf(beforeTheStart, undefined, 100),
        consumer.batchOf(asked({ type: 'event_published', data: {} }), undefined, 100),
      ]),
    );
    const ending = await Effect.runPromise(
      consumer.batchOf(asked(endingOfAnotherCapability, runOf('interaction', 'brain:alpha')), undefined, 100),
    );
    const resumed = await Effect.runPromise(consumer.batchOf(asked(askedToCancel), 'cancel', 100));

    expect([...batches, ending, resumed].map(({ deliveries }) => deliveries)).toEqual([[], [], [], []]);
  });
});
