import type { AppRuntime } from '@beonauto/api';
import { makeCatalog, makeDispatcher, type DispatcherServices, type Registration } from '@beonauto/operations';
import { defineSendExecutionEvent, makeOrchestration } from '@beonauto/orchestration';
import type { TemporalSettings } from '@beonauto/orchestration/settings';
import { defineExecuteSpec, makeSpecOperations, type Primitive } from '@beonauto/specs';

import { routesFor } from '../composition/served-routes.ts';
import type { Served } from '../lifecycle/lifecycle.ts';
import { openWorkflowClient } from './workflow-client.ts';
import { startWorkflowWorker, workflowCodeOf, type WorkflowWorkerParts } from './workflow-worker.ts';

function longestExecutionOf(primitives: readonly Primitive[]): number {
  return Math.max(1, ...primitives.map(({ longestExecutionMs }) => longestExecutionMs));
}

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

export interface WorkflowParts {
  readonly settings: TemporalSettings;
  readonly primitives: readonly Primitive[];
  readonly orgOperations: readonly OrgOperation[];
  readonly logs: WorkflowWorkerParts['logs'];
}

export async function serveWorkflows(
  runtime: AppRuntime<DispatcherServices>,
  { settings, primitives, orgOperations, logs }: WorkflowParts,
): Promise<Served> {
  const workflowBundle = await workflowCodeOf(settings);
  const { client, closing } = await openWorkflowClient(runtime, settings, {
    longestNestedExecutionMs: longestExecutionOf(primitives),
  });
  const served = [...primitives, makeOrchestration({ client })];
  const catalog = makeCatalog([...orgOperations, ...makeSpecOperations(served), defineSendExecutionEvent(client)]);
  const dispatcher = makeDispatcher([]);
  const executeSpec = defineExecuteSpec(primitives);
  const worker = startWorkflowWorker({ runtime, settings, dispatcher, executeSpec, workflowBundle, logs });
  return { routes: [...routesFor(runtime, catalog, dispatcher), closing], stopWork: worker.stop };
}
