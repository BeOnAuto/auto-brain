import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { eventTrigger, type TriggerFilter } from '../reaction-testing/brain-writes.ts';
import { followedRecordOf, saidRefusals } from '../reaction-testing/followed-records.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { triggersActivated } from '../triggers/trigger-rows.ts';
import { reactionExecutionIdOf } from './reaction-ids.ts';
import type { ReactionStart } from './reaction-options.ts';
import { mostReactionDepth, subscriptionStarts } from './subscription-starts.ts';

const brainKey = 'brain/acme/alpha/';

const at = '2026-10-01T09:00:00.000Z';

const topRuns: ReadonlyMap<string, string> = new Map([
  ['r-of-close', 'close'],
  ['r-of-other', 'other'],
]);

async function subscribedAt(
  database: HostDatabase,
  version: number,
  name: string,
  ...filters: readonly TriggerFilter[]
) {
  const activation = { workflow: name, version, activatedBy: `spec-${version}`, activatedAt: Date.parse(at) };
  await Effect.runPromise(
    triggersActivated(database, brainKey, { ...activation, triggers: [eventTrigger(...filters)] }),
  );
}

function subscribed(database: HostDatabase, name: string, ...filters: readonly TriggerFilter[]) {
  return subscribedAt(database, 1, name, ...filters);
}

async function starting() {
  const database = await openedOn(await onSQLite());
  const starts: ReactionStart[] = [];
  const { refusals, said } = saidRefusals();
  const consumer = subscriptionStarts({
    database,
    starting: {
      start: (_brainKey, start) =>
        Effect.sync(() => {
          starts.push(start);
        }),
      startDeferred: () => Effect.succeed(0),
    },
    refusals,
    workflowOfRun: (_brainKey, executionId) => Effect.succeed(topRuns.get(executionId)),
    now: () => 0,
  });
  const delivered = (followed: ReturnType<typeof followedRecordOf>) =>
    Effect.runPromise(
      Effect.flatMap(consumer.batchOf(followed, undefined, 100), ({ deliveries }) =>
        Effect.forEach(deliveries, ({ deliver }) => deliver, { discard: true }),
      ),
    );
  return { database, consumer, delivered, starts: () => starts, said };
}

describe('the starts of the workflows whose trigger an event matches', () => {
  it('start each workflow whose filter takes the event, with the event as input, one deeper, under an id of the record', async () => {
    const { database, delivered, starts } = await starting();
    await subscribed(database, 'close', { type: 'go', data: { region: 'eu' } });
    await subscribed(database, 'other', { type: 'stop' }, { type: 'go', data: { region: 'us' } });

    await delivered(followedRecordOf({ region: 'eu' }));

    expect(starts()).toEqual([
      {
        org: 'acme',
        brain: 'alpha',
        workflow: 'close',
        version: 1,
        executionId: reactionExecutionIdOf('close', 1, '/schedule/on', 'record-1'),
        input: [{ specversion: '1.0', id: 'e1', source: '/acme', type: 'go', time: at, data: { region: 'eu' } }],
        depth: 1,
        cause: 'record-1',
        trigger: { kind: 'event', reference: '/schedule/on' },
      },
    ]);
  });

  it('say once for each version of the trigger that a filter failed on an event, which it then does not match', async () => {
    const { database, delivered, starts, said } = await starting();
    const failing = { type: 'go', data: '${ .a.b }' };
    await subscribed(database, 'broken', failing);

    await delivered(followedRecordOf('text'));
    await delivered(followedRecordOf('more text'));
    await subscribedAt(database, 2, 'broken', failing);
    await delivered(followedRecordOf('text again'));
    const failed =
      "broken: The filter of the workflow's event trigger failed on an event, so it did not match: An expression failed:  .a.b : RuntimeError: Cannot index string with string (at /schedule/on/any/0)";

    expect([starts(), said()]).toEqual([[], [failed, failed]]);
  });
});

describe('the starts a workflow is kept from', () => {
  it('are those for records about its own runs, about runs one of its runs began, or past the reaction depth', async () => {
    const { database, delivered, starts, said } = await starting();
    await subscribed(database, 'close', { type: 'go' });

    await delivered(followedRecordOf(null, { ownedBy: ['close'] }));
    await delivered(followedRecordOf(null, { topRun: 'r-of-close' }));
    await delivered(followedRecordOf(null, { topRun: 'r-of-other', depth: mostReactionDepth }));
    await delivered(followedRecordOf(null, { depth: mostReactionDepth + 1 }));

    expect(starts().map(({ depth }) => depth)).toEqual([mostReactionDepth]);
    expect(said()).toEqual([
      'close: An event matched the event trigger of the workflow at reaction depth 9, past the 8 a chain of reactions may reach',
    ]);
  });
});

describe('the subscriptions an event is matched against', () => {
  it('are taken in batches, each from where the last one ended, and a start skipped is said', async () => {
    const { database, consumer, said } = await starting();
    await subscribed(database, 'a', { type: 'go' });
    await subscribed(database, 'b', { type: 'go' });
    await subscribed(database, 'c', { type: 'go' });
    const followed = followedRecordOf(null);

    const first = await Effect.runPromise(consumer.batchOf(followed, undefined, 2));
    const second = await Effect.runPromise(consumer.batchOf(followed, first.through, 2));
    await Effect.runPromise(consumer.skipped(followed, { key: 'c', workflow: 'c', deliver: Effect.void }, 'refused'));

    expect([first.deliveries.length, first.through, first.more, second.deliveries.length, second.more]).toEqual([
      2,
      'b',
      true,
      1,
      false,
    ]);
    expect(said()).toEqual(['c: The workflow could not be started by its event trigger: refused']);
  });
});
