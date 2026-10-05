import { Conflict, type Settlement } from '@beonauto/operations';
import type { SettleExecution } from '@beonauto/specs';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { faultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { runId } from '../testing/probe-subjects.ts';
import { ledgerRecordStore, mostSettleAttempts } from './ledger-record-store.ts';

const run = { executionId: runId, attributes: {} };

const succeeded: Settlement = { status: 'succeeded', output: 'done' };

const stillRunning: SettleExecution = () =>
  Effect.fail(new Conflict({ detail: 'The execution runs within the call that started it, so it cannot be settled' }));

const brokeDown: SettleExecution = () => Effect.die(new Error('The ledger broke down'));

describe('the record store of the host', () => {
  it('tries again a settlement the record refuses, and gives it up as settled otherwise after its last attempt', async () => {
    const recordStore = ledgerRecordStore(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), stillRunning);
    const settle = Effect.flip(recordStore.settle({ executionId: runId, settlement: succeeded }, run));

    const refusals = await Effect.runPromise(
      Effect.forEach(Array.from({ length: mostSettleAttempts - 1 }), () => settle),
    );
    const last = await Effect.runPromise(recordStore.settle({ executionId: runId, settlement: succeeded }, run));

    expect(refusals).toHaveLength(mostSettleAttempts - 1);
    expect(refusals.at(-1)).toMatchObject({
      output: 'settle',
      detail: 'The execution runs within the call that started it, so it cannot be settled',
    });
    expect(last).toBe('settled_otherwise');
  });

  it('counts a settlement that broke down as an attempt, to be dispatched again', async () => {
    const recordStore = ledgerRecordStore(await openedOn({ store: 'sqlite', file: aSQLiteFile() }), brokeDown);

    const failure = await Effect.runPromise(
      Effect.flip(recordStore.settle({ executionId: runId, settlement: { status: 'failed' } }, run)),
    );

    expect(failure.detail).toContain('The ledger broke down');
  });

  it('fails a settlement or a due time it cannot record, to be dispatched again', async () => {
    const database = faultyDatabase(await openedOn({ store: 'sqlite', file: aSQLiteFile() }));
    const recordStore = ledgerRecordStore(database, stillRunning);
    database.failing(true);

    const failures = await Effect.runPromise(
      Effect.all([
        Effect.flip(recordStore.settle({ executionId: runId, settlement: succeeded }, run)),
        Effect.flip(recordStore.noteDue({ executionId: runId, version: 1, nextDueAt: null }, run)),
      ]),
    );

    expect(failures).toEqual([
      expect.objectContaining({ output: 'settle', detail: 'The database was told to fail' }),
      expect.objectContaining({ output: 'note_due', detail: 'The database was told to fail' }),
    ]);
  });
});
