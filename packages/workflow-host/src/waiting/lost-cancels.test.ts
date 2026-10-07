import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { at, brainCreated, recorded } from '../reaction-testing/brain-writes.ts';
import { until } from '../reaction-testing/until.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { startedByAHostThatDied } from '../waiting-testing/crashed-host.ts';
import { followedHost, followedThroughTheLatest, settledIn } from '../waiting-testing/followed-host.ts';
import {
  askedCancel,
  lostCancelId,
  lostExecutionId,
  lostRunId,
  lostStart,
  lostStream,
  startedThenCancelled,
} from '../waiting-testing/lost-run.ts';
import { pendingCancelRowsAfter } from './pending-cancel-rows.ts';

describe('a host that died after it started a run and before it read the cancel its follower had passed over', () => {
  it('leaves the cancel to the first resume of the next host, which ends the run cancelled', async () => {
    const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
    const database = await openedOn(settings);
    await brainCreated(database.store, 'alpha');
    const first = await hostedOn(settings);
    await startedThenCancelled(database);
    await followedThroughTheLatest(database);
    await first.host.stop();
    await startedByAHostThatDied(database, lostRunId, lostStart);

    const next = await hostedOn(settings);
    next.know(lostExecutionId);
    const settlement = await settledIn(next)(lostExecutionId);

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'cancelled',
      kind: askedCancel.kind,
      detail: askedCancel.reason,
      by: askedCancel.by,
    });
  });
});

const rejectedUnstarted = {
  type: 'execution_rejected',
  rejection: { reason: 'unavailable', detail: 'The workflow could not be started' },
  primitive: 'orchestration',
  name: 'pause',
  spec_version: 1,
  by: 'brain:alpha',
  at,
};

describe('a cancel the follower passes over for a run the host has not started', () => {
  it('is kept by the run with its request, and cleared when the run ends without ever starting', async () => {
    const { database } = await followedHost();
    const pending = () => Effect.runPromise(pendingCancelRowsAfter(database, '', 10));

    await startedThenCancelled(database);
    const kept = await until(pending, (rows) => rows.length > 0);
    await recorded(database.store, lostStream, rejectedUnstarted);
    const cleared = await until(pending, (rows) => rows.length === 0);

    expect(kept).toEqual([{ runId: lostRunId, cause: lostCancelId, cancel: askedCancel }]);
    expect(cleared).toEqual([]);
  });
});
