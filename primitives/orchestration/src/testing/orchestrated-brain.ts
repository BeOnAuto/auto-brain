import { setTimeout } from 'node:timers/promises';

import type { Outcome } from '@beonauto/operations';
import { memoryLedger } from '@beonauto/operations/testing';
import { echo } from '@beonauto/specs/testing';
import type { WorkflowHost } from '@beonauto/workflow-host';
import { Schema } from 'effect';

import { makeWorkflowAdapter } from '../primitive/workflow.ts';
import { brainOn, type Brain } from './brain.ts';
import { testHost } from './test-host.ts';

export interface OrchestratedBrain extends Brain {
  readonly host: WorkflowHost;
  readonly settled: (executionId: string) => Promise<Outcome>;
  readonly close: () => Promise<void>;
}

const mostDurationMs = 2_592_000_000;

const StartedSchema = Schema.Struct({ output: Schema.Struct({ status: Schema.Literal('started') }) });

const isStarted = Schema.is(StartedSchema);

export async function orchestratedBrain(): Promise<OrchestratedBrain> {
  const ledger = memoryLedger();
  const nested = brainOn(ledger, [echo]);
  const host = await testHost(nested);
  const brain = brainOn(ledger, [makeWorkflowAdapter({ runs: host, mostDurationMs, longestCallMs: 660_000 }), echo]);
  const settled = async (executionId: string): Promise<Outcome> => {
    const outcome = await brain.call(brain.getExecution, { execution_id: executionId });
    if (!isStarted(outcome)) {
      return outcome;
    }
    await setTimeout(10);
    return settled(executionId);
  };
  return { ...brain, host, settled, close: () => host.stop() };
}
