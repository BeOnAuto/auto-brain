import { messageIdOf } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { alpha, eventTrigger, published, recorded, specRecorded } from '../reaction-testing/brain-writes.ts';
import { reactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import type { Consumer } from './consumers.ts';

function recordingIds(name: string, types: readonly string[], received: (id: string) => void): Consumer {
  return {
    name,
    types,
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    batchOf: (followed, after) =>
      Effect.succeed({
        deliveries:
          after === undefined
            ? [
                {
                  key: followed.event.event.id,
                  workflow: 'archive',
                  deliver: Effect.sync(() => {
                    received(followed.event.event.id);
                  }),
                },
              ]
            : [],
        through: followed.event.event.id,
        more: false,
      }),
    skipped: () => Effect.void,
  };
}

describe('a record of a brain the follower cannot read', () => {
  it('is said and passed over, as an event, a fact of a run or a spec, while a workflow of the brain reacts to its type', async () => {
    const reacting = await reactingHost();
    const { store } = reacting.database;
    const trigger = eventTrigger(
      { type: 'com.acme.sentinel' },
      { type: 'execution_started' },
      { type: 'spec_created' },
    );
    await specRecorded(store, { name: 'watch', version: 1, triggers: [trigger] });
    await recorded(store, `${alpha}events/bad`, { type: 'event_published', event: 'not an event' });
    await recorded(store, `${alpha}executions/r-bad`, { type: 'execution_started', name: 7 });
    await recorded(store, `${alpha}specs/orchestration`, { type: 'spec_created', name: 7 });

    await published(store, { id: 's1', type: 'com.acme.sentinel' });
    await until(
      () => Promise.resolve(reacting.reactions.starts()),
      (starts) => starts.some(({ cause }) => cause === messageIdOf(`${alpha}events/s1`, 1)),
    );

    expect(reacting.notes()).toMatchObject([
      { kind: 'record_unreadable', org: 'acme', brain: 'alpha', type: 'event_published' },
      { kind: 'record_unreadable', org: 'acme', brain: 'alpha', type: 'execution_started' },
      { kind: 'record_unreadable', org: 'acme', brain: 'alpha', type: 'spec_created' },
    ]);
  });
});

describe('a consumer the host is given', () => {
  it('is offered the events of the types it names, though nothing in the brain reacts, and one naming none is offered nothing', async () => {
    const received: string[] = [];
    const record = (id: string) => {
      received.push(id);
    };
    const noting = recordingIds('noting', ['com.acme.noted'], record);
    const wantingNothing = recordingIds('nothing', [], record);
    const reacting = await reactingHost({ consumers: [noting, wantingNothing] });

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.noted' });
    await published(reacting.database.store, { id: 'e2', type: 'com.acme.other' });
    await published(reacting.database.store, { id: 'e3', type: 'com.acme.noted' });
    const delivered = await until(
      () => Promise.resolve<readonly string[]>([...received]),
      (ids) => ids.length >= 2,
    );

    expect(delivered).toEqual(['e1', 'e3']);
  });
});
