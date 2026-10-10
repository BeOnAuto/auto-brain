import { makeAppRuntime } from '@beonauto/api';
import { defineStartVersion } from '@beonauto/definitions';
import { echo } from '@beonauto/definitions/testing';
import { ledgerLayer } from '@beonauto/ledger/sqlite3';
import { makeDispatcher } from '@beonauto/operations';
import { filterSandboxOf, machineSandboxOf, programPool } from '@beonauto/workflow-engine/dsl';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { applicationLayer } from '../composition/composition-root.ts';
import { hostWorkOf } from './host-work.ts';

const unknownRun = { org: 'acme', brain: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' };

const lineage = { causationId: 'cancel-1', correlationId: unknownRun.id };

describe('the machine the workflow host decides runs with', () => {
  it("is the coordination's functions and runtime on the pool's sandbox, so no setting of the server reaches the machine's bound on tasks without waiting", async () => {
    const runtime = await makeAppRuntime(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
    const pool = programPool({ workers: 1, heapMegabytes: 64 });
    const { machine } = hostWorkOf(runtime, makeDispatcher([]), {
      capabilities: [echo],
      startVersion: defineStartVersion([echo]),
      evaluations: pool.evaluations,
    });
    await Promise.all([pool.close(), runtime.dispose()]);

    expect(Object.keys(machine).toSorted()).toEqual(['functions', 'runtime', 'sandbox']);
    expect(machine.sandbox).toBe(pool.evaluations.machine);
    expect(Object.keys(machine.sandbox)).not.toContain('mostStepsWithoutWaiting');
  });
});

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
