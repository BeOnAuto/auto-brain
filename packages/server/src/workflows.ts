import type { AppRuntime } from '@beonauto/api';
import { brainOperations } from '@beonauto/brains';
import { makeCatalog, makeDispatcher, type DispatcherServices } from '@beonauto/operations';
import { defineSendExecutionEvent, makeOrchestration } from '@beonauto/orchestration';
import type { TemporalSettings } from '@beonauto/orchestration/settings';
import { defineExecuteSpec, makeSpecOperations, type Primitive } from '@beonauto/specs';

import type { Served } from './lifecycle.ts';
import { routesFor } from './served-routes.ts';
import { openWorkflowClient } from './workflow-client.ts';
import { startWorkflowWorker, workflowCodeOf, type WorkflowWorkerParts } from './workflow-worker.ts';

function longestExecutionOf(primitives: readonly Primitive[]): number {
  return Math.max(1, ...primitives.map(({ longestExecutionMs }) => longestExecutionMs));
}

export interface WorkflowParts {
  readonly settings: TemporalSettings;
  readonly primitives: readonly Primitive[];
  readonly logs: WorkflowWorkerParts['logs'];
}

export async function serveWorkflows(
  runtime: AppRuntime<DispatcherServices>,
  { settings, primitives, logs }: WorkflowParts,
): Promise<Served> {
  const workflowBundle = await workflowCodeOf(settings);
  const { client, closing } = await openWorkflowClient(runtime, settings, {
    longestNestedExecutionMs: longestExecutionOf(primitives),
  });
  const served = [...primitives, makeOrchestration({ client })];
  const catalog = makeCatalog([...brainOperations, ...makeSpecOperations(served), defineSendExecutionEvent(client)]);
  const dispatcher = makeDispatcher([]);
  const executeSpec = defineExecuteSpec(primitives);
  const worker = startWorkflowWorker({ runtime, settings, dispatcher, executeSpec, workflowBundle, logs });
  return { routes: [...routesFor(runtime, catalog, dispatcher), closing], stopWork: worker.stop };
}
