import type { AppRuntime, RegisterRoutes } from '@beonauto/api';
import type { DispatcherServices } from '@beonauto/operations';
import { connectOrchestration, type OrchestrationClient } from '@beonauto/orchestration';
import type { TemporalSettings } from '@beonauto/orchestration/settings';
import { Effect, Exit, Scope } from 'effect';

import { logWorkflowsOffered } from './logging.ts';

export interface WorkflowClient {
  readonly client: OrchestrationClient;
  readonly closing: RegisterRoutes;
}

export async function openWorkflowClient(
  runtime: AppRuntime<DispatcherServices>,
  settings: TemporalSettings,
): Promise<WorkflowClient> {
  await runtime.run(logWorkflowsOffered(settings));
  const scope = Effect.runSync(Scope.make());
  const client = await Effect.runPromise(connectOrchestration(settings).pipe(Scope.provide(scope)));
  return {
    client,
    closing: (routes) => {
      routes.onClose(() => Effect.runPromise(Scope.close(scope, Exit.void)));
    },
  };
}
