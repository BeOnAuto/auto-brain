import { describe, expect, it } from 'vitest';

import { brainCreated } from '../reaction-testing/brain-writes.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { startedByAHostThatDied } from '../waiting-testing/crashed-host.ts';
import { followedThroughTheLatest, settledIn } from '../waiting-testing/followed-host.ts';
import {
  askedCancel,
  lostExecutionId,
  lostRunId,
  lostStart,
  startedThenCancelled,
} from '../waiting-testing/lost-run.ts';

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
