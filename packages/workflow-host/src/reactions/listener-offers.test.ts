import { Conflict } from '@beonauto/operations';
import { callKeyText, type Json, type Submission } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { insertedListener } from '../listeners/listener-rows.ts';
import { followedRecordOf, saidRefusals } from '../reaction-testing/followed-records.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { listenerOffers } from './listener-offers.ts';

const brainKey = 'brain/acme/alpha/';

const applied: Submission = { outcome: 'applied', version: 2 };

const declinedOffer: Submission = { outcome: 'stale', version: 2, declined: 'The run took no event of this kind' };

interface Offering {
  readonly offers: () => readonly string[];
  readonly said: () => readonly string[];
  readonly consumer: ReturnType<typeof listenerOffers>;
}

function listening(database: HostDatabase, run: string, filters: readonly Json[]) {
  const runId = `acme/alpha/${run}`;
  return Effect.runPromise(
    insertedListener(database, {
      runId,
      listener: callKeyText({ executionId: runId, reference: '/do/0/wait', run: 1 }),
      brainKey,
      streamId: `${brainKey}runs/${run}`,
      armedBy: 1,
      filters: JSON.stringify(filters),
      workflow: `wf-${run}`,
      passed: true,
    }),
  );
}

function offering(database: HostDatabase, answer: (runId: string) => Effect.Effect<Submission, Conflict>): Offering {
  const offers: string[] = [];
  const { refusals, said, say } = saidRefusals();
  const consumer = listenerOffers({
    database,
    refusals,
    offer: ({ runId, key, listener }) =>
      Effect.andThen(
        Effect.sync(() => {
          offers.push(`${runId} ${key} ${listener.reference}`);
        }),
        answer(runId),
      ),
    declined: (runId, detail) => say(`${runId} declined: ${detail}`),
    now: () => 0,
  });
  return { offers: () => offers, said, consumer };
}

function declinedByTheFirst(runId: string): Effect.Effect<Submission, Conflict> {
  return runId.endsWith('run-a')
    ? Effect.succeed(declinedOffer)
    : Effect.fail(new Conflict({ detail: 'The ledger cannot be reached' }));
}

function deliveredAll(consumer: Offering['consumer'], followed: ReturnType<typeof followedRecordOf>, most: number) {
  return Effect.runPromise(
    Effect.flatMap(consumer.batchOf(followed, undefined, most), (batch) =>
      Effect.as(
        Effect.forEach(batch.deliveries, ({ deliver }) => Effect.ignore(deliver), { discard: true }),
        batch,
      ),
    ),
  );
}

describe('the offers of an event to the runs that listen for its type', () => {
  it('go to each run whose filter takes it, but not to the run that emitted it', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database, 'run-a', [{ type: 'go' }]);
    await listening(database, 'run-b', [{ type: 'go', data: { region: 'us' } }]);
    await listening(database, 'run-c', [{ type: 'go' }]);
    await listening(database, 'run-d', [{ type: '${ "go" }' }, { type: 'go', data: { region: 'eu' } }]);
    const { offers, consumer } = offering(database, () => Effect.succeed(applied));

    const batch = await deliveredAll(
      consumer,
      followedRecordOf({ region: 'eu' }, { emitter: { executionId: 'run-c', workflow: 'wf-run-c' } }),
      100,
    );

    expect([offers(), batch.more]).toEqual([
      ['acme/alpha/run-a record-1 /do/0/wait', 'acme/alpha/run-d record-1 /do/0/wait'],
      false,
    ]);
  });

  it('are taken in batches, each from where the last one ended', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database, 'run-a', [{ type: 'go' }]);
    await listening(database, 'run-b', [{ type: 'go' }]);
    await listening(database, 'run-c', [{ type: 'go' }]);
    const { offers, consumer } = offering(database, () => Effect.succeed(applied));
    const followed = followedRecordOf(null);

    const first = await deliveredAll(consumer, followed, 2);
    const second = await Effect.runPromise(consumer.batchOf(followed, first.through, 2));

    expect([offers().length, first.more, second.deliveries.length, second.more]).toEqual([2, true, 1, false]);
  });
});

describe('an offer of an event to a listening run', () => {
  it('is said when the run declines it, fails when it cannot be made, and is said when skipped', async () => {
    const database = await openedOn(await onSQLite());
    await listening(database, 'run-a', [{ type: 'go' }]);
    await listening(database, 'run-b', [{ type: 'go' }]);
    const { said, consumer } = offering(database, declinedByTheFirst);
    const followed = followedRecordOf(null);

    const { deliveries } = await Effect.runPromise(consumer.batchOf(followed, undefined, 10));
    const outcomes = await Effect.runPromise(Effect.forEach(deliveries, ({ deliver }) => Effect.isSuccess(deliver)));
    const failed = { key: 'k', workflow: 'wf-run-b', deliver: Effect.void };
    await Effect.runPromise(consumer.skipped(followed, failed, 'The ledger cannot be reached'));

    expect(outcomes).toEqual([true, false]);
    expect(said()).toEqual([
      'acme/alpha/run-a declined: The run took no event of this kind',
      'wf-run-b: An event could not be offered to a run waiting for it: The ledger cannot be reached',
    ]);
  });
});
