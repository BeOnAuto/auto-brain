import { callKeyText } from '@beonauto/workflow-engine';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { waitingRow } from '../calls/call-rows.ts';
import { alpha, at, brainCreated, recorded } from '../reaction-testing/brain-writes.ts';
import { runAt, startOf, workflow } from '../testing/host-documents.ts';
import { aSQLiteFile, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { followedThroughTheLatest, settledIn } from '../waiting-testing/followed-host.ts';
import { parentId, parentRun } from '../waiting-testing/waiting-parent.ts';

const child = '0199a3c4-7d2e-7c1a-9b3f-0000000000c1';

const asking = workflow('do:\n  - ask: { call: notify, with: { to: ada } }');

const key = callKeyText({ executionId: parentRun, reference: '/do/0/ask', run: 1 });

const ending = {
  type: 'execution_succeeded',
  output: 'checked',
  record: {},
  primitive: 'orchestration',
  name: 'check',
  spec_version: 1,
  by: 'brain:alpha',
  at,
  called_by: { execution_id: parentId, reference: '/do/0/ask', run: 1 },
};

describe('a host that died after it marked a call waiting and before it read the ending of the call’s run', () => {
  it('leaves the answer to the first resume of the next host, which reads the ending the follower passed over', async () => {
    const settings = { store: 'sqlite', file: aSQLiteFile() } as const;
    const database = await openedOn(settings);
    await brainCreated(database.store, 'alpha');
    const first = await hostedOn(settings, { answer: () => Effect.never });
    first.know(parentId);
    await Effect.runPromise(first.host.start(runAt(parentId), startOf(asking)));
    await recorded(database.store, `${alpha}executions/${child}`, ending);
    await followedThroughTheLatest(database);
    await first.host.stop();
    await Effect.runPromise(waitingRow(database, key, child));

    const second = await hostedOn(settings, { answer: () => Effect.never });
    second.know(parentId);
    const settlement = await settledIn(second)(parentId);

    expect(settlement).toEqual({ status: 'succeeded', output: 'checked' });
    expect(first.settlements().get(parentId)).toBeUndefined();
  });
});
