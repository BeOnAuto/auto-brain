import { fileURLToPath } from 'node:url';

import type { SettleExecution } from '@beonauto/specs';
import { activityInfo } from '@temporalio/activity';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Data, Effect, type Scope } from 'effect';

import { makeActivities, workflowRunOf } from './activities.ts';
import type { ExecuteSpec } from './dependencies.ts';
import { connectionOptionsOf, type TemporalSettings } from './temporal-settings.ts';

export interface OrchestrationWorkerOptions {
  readonly settings: TemporalSettings;
  readonly executeSpec: ExecuteSpec;
  readonly settle: SettleExecution;
}

export class OrchestrationWorkerError extends Data.TaggedError('OrchestrationWorkerError')<{
  readonly detail: string;
}> {}

interface RunningWorker {
  readonly running: Promise<void>;
  readonly stop: () => Promise<void>;
}

const workflowsPath = fileURLToPath(new URL('../workflow/workflows.ts', import.meta.url));

const failureConverterPath = fileURLToPath(new URL('failure-converter.ts', import.meta.url));

export const runOrchestrationWorker = Effect.fnUntraced(function* (
  options: OrchestrationWorkerOptions,
): Effect.fn.Return<void, OrchestrationWorkerError, Scope.Scope> {
  const worker = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => startWorker(options),
      catch: (error) =>
        new OrchestrationWorkerError({
          detail: `The orchestration worker could not start: ${String(error)}`,
        }),
    }),
    (started) => Effect.promise(() => started.stop()),
  );
  yield* Effect.forkScoped(Effect.promise(() => worker.running));
});

async function startWorker({ settings, executeSpec, settle }: OrchestrationWorkerOptions): Promise<RunningWorker> {
  const connection = await NativeConnection.connect(connectionOptionsOf(settings));
  try {
    const worker = await Worker.create({
      connection,
      namespace: settings.namespace,
      taskQueue: settings.taskQueue,
      workflowsPath,
      activities: makeActivities({ executeSpec, settle, currentRun: () => workflowRunOf(activityInfo()) }),
      dataConverter: { failureConverterPath },
      shutdownGraceTime: '10 seconds',
    });
    const running = worker.run();
    return {
      running,
      stop: async () => {
        worker.shutdown();
        await running;
        await connection.close();
      },
    };
  } catch (error) {
    await connection.close();
    throw error;
  }
}
