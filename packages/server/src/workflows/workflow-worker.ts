import type { AppRuntime } from '@beonauto/api';
import type { Dispatcher, DispatcherServices } from '@beonauto/operations';
import {
  installTemporalRuntime,
  requireWorkflowBundler,
  runOrchestrationWorker,
  verifiedWorkflowBundle,
} from '@beonauto/orchestration';
import type { TemporalSettings } from '@beonauto/orchestration/settings';
import type { BrainOperation } from '@beonauto/specs';
import { Effect, type Layer } from 'effect';

import { logTemporal, logUnsettled } from '../logging/logging.ts';
import { nestedExecutions, settlements } from './worker-dependencies.ts';
import { runSupervised, superviseWorker, type StartWorker, type SupervisedWorker } from './worker-supervisor.ts';

export interface WorkflowWorkerParts {
  readonly runtime: AppRuntime<DispatcherServices>;
  readonly settings: TemporalSettings;
  readonly dispatcher: Dispatcher;
  readonly executeSpec: BrainOperation;
  readonly workflowBundle: string | undefined;
  readonly logs: Layer.Layer<never>;
}

export async function workflowCodeOf({ workflowBundle }: TemporalSettings): Promise<string | undefined> {
  if (workflowBundle === undefined) {
    requireWorkflowBundler();
    return workflowBundle;
  }
  const codePath = await verifiedWorkflowBundle(workflowBundle);
  return codePath;
}

export function startWorkflowWorker({
  runtime,
  settings,
  dispatcher,
  executeSpec,
  workflowBundle,
  logs,
}: WorkflowWorkerParts): SupervisedWorker {
  installTemporalRuntime((entry) => {
    Effect.runFork(logTemporal(entry).pipe(Effect.provide(logs)));
  });
  const start: StartWorker = (onFailure) =>
    runOrchestrationWorker({
      settings,
      executeSpec: nestedExecutions(runtime, dispatcher, executeSpec),
      settle: settlements(runtime),
      reportUnsettled: (unsettled) => {
        void runtime.run(logUnsettled(unsettled));
      },
      onFailure,
      ...(workflowBundle === undefined ? {} : { workflowBundle }),
    });
  return runSupervised(superviseWorker(start).pipe(Effect.provide(logs)));
}
