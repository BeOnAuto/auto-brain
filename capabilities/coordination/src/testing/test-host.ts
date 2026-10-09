import { openWorkflowHost, type WorkflowHost } from '@beonauto/workflow-host';
import { recordedReactions, recordedWaiting } from '@beonauto/workflow-host/testing';
import { Effect, Function } from 'effect';

import { callResultOfEnding, definitionCalls } from '../calls/function-calls.ts';
import { workflowMachineOptions } from '../runs/workflow-machine-options.ts';
import type { Brain } from './brain.ts';

export function testHost(nested: Brain): Promise<WorkflowHost> {
  return openWorkflowHost({
    database: { store: 'sqlite', file: ':memory:' },
    machine: workflowMachineOptions,
    perform: definitionCalls(nested.executeNested),
    settle: nested.settle,
    reports: {
      unsettled: Effect.logWarning,
      trouble: Effect.logWarning,
      lostConnection: Function.constVoid,
      note: Effect.logWarning,
    },
    sweepEveryMs: 20,
    mostCallsAtOnce: 4,
    reactions: recordedReactions().options,
    waiting: { ...recordedWaiting().options, resultOf: callResultOfEnding },
  });
}
