import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { DatabaseFailed, type HostDatabase } from '../database/host-database.ts';
import { brainCreated, eventTrigger, published, specRecorded } from '../reaction-testing/brain-writes.ts';
import { followerOver } from '../reaction-testing/follower-over.ts';
import { until } from '../reaction-testing/until.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';

const beta = 'brain/acme/beta/';

interface HeldBack {
  readonly database: HostDatabase;
  readonly release: () => void;
}

function sweptAtOnceAndRegistryFailing(database: HostDatabase, brainKey: string): HeldBack {
  const state = { released: false, swept: false };
  const store: HostDatabase['store'] = {
    ...database.store,
    readAppended: (after, most) =>
      after === undefined || state.released
        ? database.store.readAppended(after, most)
        : Promise.resolve({ streams: [], through: after, more: false }),
  };
  return {
    database: {
      ...database,
      store,
      read: (statement) =>
        Effect.suspend(() => {
          const text = statement.strings.join('');
          state.swept ||= text.includes('FROM workflow_followed_brains') && statement.values.includes(brainKey);
          const registry = text.includes('FROM workflow_followed_orgs WHERE stream_id');
          return registry && !state.swept
            ? Effect.fail(new DatabaseFailed({ detail: 'The registry could not be read' }))
            : database.read(statement);
        }),
    },
    release: () => {
      state.released = true;
    },
  };
}

describe('a brain another process creates, swept before its registry could be read', () => {
  it(
    'is passed from its first record, so its first event starts a workflow without another append',
    { timeout: 30_000 },
    async () => {
      const database = await openedOn(await onSQLite());
      const held = sweptAtOnceAndRegistryFailing(database, beta);
      const reactions = followerOver(held.database, 20);
      const trigger = eventTrigger({ type: 'com.acme.closed' });

      await brainCreated(database.store, 'beta');
      await specRecorded(database.store, { name: 'close', version: 1, triggers: [trigger] }, beta);
      await published(database.store, { id: 'first', type: 'com.acme.closed' }, {}, beta);
      held.release();
      const starts = await until(
        () => Promise.resolve(reactions.starts()),
        (found) => found.length > 0,
        1000,
      );

      expect(starts.map(({ brain, workflow }) => [brain, workflow])).toEqual([['beta', 'close']]);
    },
  );
});
