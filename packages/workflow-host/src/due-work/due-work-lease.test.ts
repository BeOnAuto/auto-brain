import { describe, expect, it } from 'vitest';

import { eventually } from '../testing/eventually.ts';
import { aSQLiteFile } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { fakeDueWork } from './fake-due-work.ts';

describe('the due rows of a projection, across hosts of one database', () => {
  it('are performed by the host that holds the lease alone, and by the next once it stops', async () => {
    const database = { store: 'sqlite', file: aSQLiteFile() } as const;
    const rows = fakeDueWork();
    const first = await hostedOn(database, { sweepEveryMs: 50, holder: 'first', dueWork: [rows.work('first')] });
    await hostedOn(database, { sweepEveryMs: 50, holder: 'second', dueWork: [rows.work('second')] });

    rows.add('before', Date.now());
    await eventually(rows.performed, (performed) => performed.length === 1);
    await first.host.stop();
    rows.add('after', Date.now());
    await eventually(rows.performed, (performed) => performed.length === 2, 2000);

    expect(rows.performed().map(({ key, by }) => [key, by])).toEqual([
      ['before', 'first'],
      ['after', 'second'],
    ]);
    expect(rows.attempts()).toHaveLength(2);
  }, 60_000);
});
