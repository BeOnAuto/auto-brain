import { makeAppRuntime } from '@beonauto/api';
import { defineStartVersion } from '@beonauto/definitions';
import { echo } from '@beonauto/definitions/testing';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { makeDispatcher } from '@beonauto/operations';
import { filterSandboxOf, machineSandboxOf } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { applicationLayer } from '../composition/composition-root.ts';
import { hostWorkOf } from './host-work.ts';

const unknownRun = { org: 'acme', brain: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const lineage = { causationId: 'cancel-1', correlationId: unknownRun.id };

describe('the cancels the workflow host hands to the runtime of the server', () => {
  it('settle nothing for a run the ledger does not have, and record the cancel of a run that has not started yet', async () => {
    const runtime = await makeAppRuntime(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
    const { waiting } = hostWorkOf(runtime, makeDispatcher([]), {
      capabilities: [echo],
      startVersion: defineStartVersion([echo]),
      evaluations: { machine: machineSandboxOf(), filters: filterSandboxOf() },
    });

    const settled = await Effect.runPromise(
      Effect.as(waiting.cancelDeferred(unknownRun, { kind: 'requested', reason: 'No longer needed' }, lineage), 'left'),
    );
    const cancelled = await Effect.runPromise(
      waiting.cancel(unknownRun, { kind: 'parent_ended', reason: 'The run that waited for it ended' }, lineage),
    );
    await runtime.dispose();

    expect([settled, cancelled]).toEqual(['left', 'requested']);
  });
});
