import type { ArmListener } from '@beonauto/workflow-engine';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { rowsOf } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { refusalsOn } from '../reactions/refusals.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { mostListenersInABrain, sqlListeners } from './sql-listeners.ts';

const attributes = { definition: { name: 'await-approval', version: 1 }, caller: { id: 'acme-admin' } };

const run = { runId: 'acme/alpha/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', attributes };

const armedBy = { version: 3, lastStep: null };

function listenerAt(reference: string): ArmListener {
  return { kind: 'arm_listener', key: { runId: run.runId, reference, run: 1 }, filters: [{ type: 'go' }] };
}

const RefusalRow = Schema.Struct({ workflow: Schema.String, reason: Schema.String });

describe('the listeners of a brain', () => {
  it('are 4,096 in a brain at most: one more is refused and said, and its run takes only the events sent to it', async () => {
    const database = await openedOn(await onSQLite());
    const listeners = sqlListeners(database, refusalsOn(database, Date.now));
    await Effect.runPromise(
      database.write(
        statement`WITH RECURSIVE listening (at) AS (
            SELECT 1 UNION ALL SELECT at + 1 FROM listening WHERE at < ${mostListenersInABrain - 1}
          )
          INSERT INTO workflow_listeners (run_key, listener, brain_key, stream_id, armed_by, filters, workflow, passed)
          SELECT 'acme/alpha/r' || at, 'listener', 'brain/acme/alpha/', 'brain/acme/alpha/run-logs/r' || at, 1, '[]',
            'other', 1
          FROM listening`,
      ),
    );

    const receipts = await Effect.runPromise(
      Effect.forEach(['/do/0/await', '/do/1/await'], (reference) => listeners.arm(listenerAt(reference), run, armedBy)),
    );
    const refusals = await Effect.runPromise(
      rowsOf(RefusalRow, database.read(statement`SELECT workflow, reason FROM workflow_reaction_refusals`)),
    );

    expect(receipts).toEqual(['armed', 'refused']);
    expect(refusals).toEqual([
      {
        workflow: 'await-approval',
        reason:
          'A run listened for events of the brain while 4096 listeners were already open in it, the most a brain keeps; the run takes only the events sent to it',
      },
    ]);
  });
});

describe('a listener the host tables cannot record', () => {
  it('fails to arm or cancel, to be dispatched again', async () => {
    const database = faultyDatabase(await openedOn(await onSQLite()));
    const listeners = sqlListeners(database, refusalsOn(database, Date.now));
    const listener = listenerAt('/do/0/await');
    database.failing(true);

    const failures = await Effect.runPromise(
      Effect.all([
        Effect.flip(listeners.arm(listener, run, armedBy)),
        Effect.flip(listeners.cancel({ kind: 'cancel_listener', key: listener.key }, run)),
      ]),
    );

    expect(failures).toEqual([
      expect.objectContaining({ output: 'arm_listener' }),
      expect.objectContaining({ output: 'cancel_listener' }),
    ]);
  });
});
