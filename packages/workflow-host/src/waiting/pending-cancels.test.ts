import { messageIdOf } from '@beonauto/operations';
import type { RunInput } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainCreated } from '../reaction-testing/brain-writes.ts';
import { faultyDatabase } from '../testing/faulty-database.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { startedByAHostThatDied } from '../waiting-testing/crashed-host.ts';
import { askedCancel, lostRunId, lostStart, lostStream, startedThenCancelled } from '../waiting-testing/lost-run.ts';
import { pendingCancelsGivenOnce } from './pending-cancels.ts';

describe('the cancels asked of the runs going, read at the first resume after a host takes the workflows', () => {
  it('are read again at the next resume when the runs could not be read, and given once', async () => {
    const database = await openedOn({ store: 'sqlite', file: aSQLiteFile() });
    await brainCreated(database.store, 'alpha');
    await startedThenCancelled(database);
    await startedByAHostThatDied(database, lostRunId, lostStart);
    const faulty = faultyDatabase(database);
    const submitted: RunInput[] = [];
    const troubles: string[] = [];
    const cancelsAsked = pendingCancelsGivenOnce(
      {
        database: faulty,
        submitted: (input) =>
          Effect.sync(() => {
            submitted.push(input);
            return { outcome: 'applied', version: 2 };
          }),
        now: () => 1,
      },
      (what) =>
        Effect.sync(() => {
          troubles.push(what);
        }),
    );

    faulty.failing(true);
    await Effect.runPromise(cancelsAsked);
    const whileFailing = submitted.length;
    faulty.failing(false);
    await Effect.runPromise(cancelsAsked);
    await Effect.runPromise(cancelsAsked);

    expect(troubles).toEqual(['The cancels asked of the runs could not be read; the next sweep reads them again']);
    expect(whileFailing).toBe(0);
    expect(submitted).toEqual([
      {
        kind: 'cancel_requested',
        executionId: lostRunId,
        at: 1,
        cancel: askedCancel,
        cause: messageIdOf(lostStream, 2),
      },
    ]);
  });
});
