import { echo } from '@beonauto/specs/testing';
import { Client, Connection } from '@temporalio/client';
import { Effect, Exit, Scope } from 'effect';

import { connectOrchestration, type OrchestrationClient } from '../primitive/orchestration-client.ts';
import { makeOrchestration } from '../primitive/orchestration-primitive.ts';
import { runOrchestrationWorker } from '../worker/orchestration-worker.ts';
import type { TemporalSettings } from '../worker/temporal-settings.ts';
import { brainWith, type Brain } from './brain.ts';
import { failureRecorder } from './failure-recorder.ts';
import { settingsFor } from './temporal.ts';

export interface OrchestratedBrain extends Brain {
  readonly client: OrchestrationClient;
  readonly temporal: Client;
  readonly close: () => Promise<void>;
}

export async function orchestratedBrain(taskQueue: string): Promise<OrchestratedBrain> {
  const settings: TemporalSettings = settingsFor(taskQueue);
  const scope = Effect.runSync(Scope.make());
  const client = await Effect.runPromise(connectOrchestration(settings).pipe(Scope.provide(scope)));
  const brain = brainWith([makeOrchestration({ client }), echo]);
  await Effect.runPromise(
    runOrchestrationWorker({
      settings,
      executeSpec: brain.executeNested,
      settle: brain.settle,
      onFailure: failureRecorder().onFailure,
    }).pipe(Scope.provide(scope)),
  );
  const connection = await Connection.connect({ address: settings.address });
  return {
    ...brain,
    client,
    temporal: new Client({ connection }),
    close: async () => {
      await connection.close();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
