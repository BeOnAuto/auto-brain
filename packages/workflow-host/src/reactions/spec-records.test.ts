import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf, WholeNumber } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { triggerOfSource } from '../reaction-testing/brain-writes.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { specRecordsOn } from './spec-records.ts';

const brainKey = 'brain/acme/alpha/';

const at = '2026-10-01T09:00:00.000Z';

const every = JSON.stringify({ kind: 'every', milliseconds: 60_000 });

const SubscriptionRow = Schema.Struct({ workflow: Schema.String, version: WholeNumber, kind: Schema.String });

function created(name: string, content: Readonly<Record<string, string | boolean>>, version = 1) {
  return { type: version === 1 ? 'spec_created' : 'spec_updated', name, version, content, by: 'acme-admin', at };
}

describe('the records of the specs of a brain, applied to its subscriptions', () => {
  it('subscribe a version whose trigger can be read, and unsubscribe at one that does not react or cannot be read', async () => {
    const database = await openedOn(await onSQLite());
    const apply = specRecordsOn(database, triggerOfSource);

    const records: readonly unknown[] = [
      created('tick', { source: every, reacts: true }),
      created('plain', { source: 'do: []' }),
      created('close', { source: every, reacts: true }),
      created('close', { source: 'do: []' }, 2),
      created('lost', { source: every, reacts: true }),
      created('lost', { source: 'not a trigger', reacts: true }, 2),
      { type: 'spec_created', name: 7 },
    ];

    await Effect.runPromise(Effect.forEach(records, (record) => apply(brainKey, record), { discard: true }));
    const subscriptions = await Effect.runPromise(
      rowsOf(SubscriptionRow, database.read(statement`SELECT workflow, version, kind FROM workflow_subscriptions`)),
    );

    expect(subscriptions).toEqual([{ workflow: 'tick', version: 1, kind: 'every' }]);
  });
});
