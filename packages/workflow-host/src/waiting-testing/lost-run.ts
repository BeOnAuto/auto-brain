import { messageIdOf } from '@beonauto/operations';

import type { HostDatabase } from '../database/host-database.ts';
import { alpha, at, recorded } from '../reaction-testing/brain-writes.ts';
import { startOf, workflow } from '../testing/host-documents.ts';

export const lostExecutionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const lostRunId = `acme/alpha/${lostExecutionId}`;

export const lostStream = `${alpha}executions/${lostExecutionId}`;

export const lostCancelId = messageIdOf(lostStream, 2);

export const lostStart = startOf(workflow('do:\n  - pause: { wait: PT1H }'));

export const askedCancel = { by: 'acme-admin', kind: 'requested', reason: 'Not needed any more' } as const;

const ofTheRun = { primitive: 'orchestration', name: 'pause', spec_version: 1, by: askedCancel.by, at };

export async function startedThenCancelled(database: HostDatabase): Promise<void> {
  await recorded(database.store, lostStream, {
    type: 'execution_started',
    input: {},
    finishes_later: true,
    ...ofTheRun,
  });
  await recorded(database.store, lostStream, {
    type: 'execution_cancel_requested',
    kind: askedCancel.kind,
    reason: askedCancel.reason,
    ...ofTheRun,
  });
}
