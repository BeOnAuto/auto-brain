import { setTimeout } from 'node:timers/promises';

import { echo } from '@beonauto/definitions/testing';
import type { Outcome } from '@beonauto/operations';
import { memoryLedger } from '@beonauto/operations/testing';
import { Schema } from 'effect';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { brainOn, type Brain } from './brain.ts';
import { testExpressionCheck } from './expression-checks.ts';
import { testHost } from './test-host.ts';
import { testBrainNames } from './test-sandbox.ts';

export interface WorkflowBrain extends Brain {
  readonly host: Awaited<ReturnType<typeof testHost>>;
  readonly settled: (runId: string) => Promise<Outcome>;
  readonly close: () => Promise<void>;
}

const mostDurationMs = 2_592_000_000;

const StartedSchema = Schema.Struct({ output: Schema.Struct({ status: Schema.Literal('started') }) });

const isStarted = Schema.is(StartedSchema);

export async function workflowBrain(): Promise<WorkflowBrain> {
  const ledger = memoryLedger();
  const nested = brainOn(ledger, [echo]);
  const host = await testHost(nested);
  const brain = brainOn(ledger, [
    makeWorkflowAdapter({
      runs: host,
      check: testExpressionCheck,
      mostDurationMs,
      longestCallMs: 660_000,
      names: testBrainNames,
    }),
    echo,
  ]);
  const settled = async (runId: string): Promise<Outcome> => {
    const outcome = await brain.call(brain.getRun, { run_id: runId });
    if (!isStarted(outcome)) {
      return outcome;
    }
    await setTimeout(10);
    return settled(runId);
  };
  return { ...brain, host, settled, close: () => host.stop() };
}
