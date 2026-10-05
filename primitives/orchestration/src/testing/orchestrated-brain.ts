import { setTimeout } from 'node:timers/promises';

import type { Outcome } from '@beonauto/operations';
import { memoryLedger } from '@beonauto/operations/testing';
import { echo } from '@beonauto/specs/testing';
import { openWorkflowHost, type WorkflowHost } from '@beonauto/workflow-host';
import { Effect, Function, Schema } from 'effect';

import { specCalls } from '../calls/spec-calls.ts';
import { makeOrchestration } from '../primitive/orchestration-primitive.ts';
import { orchestrationMachine } from '../runs/orchestration-machine.ts';
import { brainOn, type Brain } from './brain.ts';

export interface OrchestratedBrain extends Brain {
  readonly host: WorkflowHost;
  readonly settled: (executionId: string) => Promise<Outcome>;
  readonly close: () => Promise<void>;
}

export const mostDurationMs = 2_592_000_000;

const StartedSchema = Schema.Struct({ output: Schema.Struct({ status: Schema.Literal('started') }) });

const isStarted = Schema.is(StartedSchema);

export async function orchestratedBrain(): Promise<OrchestratedBrain> {
  const ledger = memoryLedger();
  const nested = brainOn(ledger, [echo]);
  const host = await openWorkflowHost({
    database: { store: 'sqlite', file: ':memory:' },
    machine: orchestrationMachine,
    perform: specCalls(nested.executeNested),
    settle: nested.settle,
    reports: { unsettled: Effect.logWarning, trouble: Effect.logWarning, lostConnection: Function.constVoid },
    sweepEveryMs: 20,
    mostCallsAtOnce: 4,
  });
  const brain = brainOn(ledger, [makeOrchestration({ runs: host, mostDurationMs, longestCallMs: 660_000 }), echo]);
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
