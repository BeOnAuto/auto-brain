import type { SettleExecution } from '@beonauto/specs';
import { activityInfo, heartbeat } from '@temporalio/activity';
import { NativeConnection, Worker } from '@temporalio/worker';
import { Data, Effect, type Scope } from 'effect';

import type { OrchestrationActivities } from '../workflow/activity-contract.ts';
import { makeActivities, workflowRunOf } from './activities.ts';
import type { ExecuteSpec, ReportUnsettled } from './dependencies.ts';
import { probeEveryMs, runtimeShutdownSignals, watchTemporal } from './temporal-runtime.ts';
import { connectionOptionsOf, type TemporalSettings } from './temporal-settings.ts';
import { failureConverterPath, workflowsPath } from './workflow-code.ts';

export class OrchestrationWorkerError extends Data.TaggedError('OrchestrationWorkerError')<{
  readonly detail: string;
}> {}

export type WorkflowCode =
  | { readonly workflowsPath: string }
  | { readonly workflowBundle: { readonly codePath: string } };

export type WorkerDefinition = WorkflowCode & {
  readonly namespace: string;
  readonly taskQueue: string;
  readonly activities: OrchestrationActivities;
  readonly dataConverter: { readonly failureConverterPath: string };
  readonly shutdownGraceTime: string;
  readonly maxCachedWorkflows: number;
  readonly maxConcurrentWorkflowTaskExecutions: number;
  readonly maxConcurrentActivityTaskExecutions: number;
};

export interface RunnableWorker {
  run(): Promise<void>;
  shutdown(): void;
  isRunning(): boolean;
}

interface WorkerConnection {
  create(definition: WorkerDefinition): Promise<RunnableWorker>;
  close(): Promise<void>;
}

export interface TemporalWorkers {
  shutdownSignals(): readonly string[];
  connect(settings: TemporalSettings): Promise<WorkerConnection>;
}

export interface OrchestrationWorkerOptions {
  readonly settings: TemporalSettings;
  readonly executeSpec: ExecuteSpec;
  readonly settle: SettleExecution;
  readonly reportUnsettled: ReportUnsettled;
  readonly onFailure: (detail: string) => void;
  readonly workflowBundle?: string;
  readonly heartbeatEveryMs?: number;
  readonly temporal?: TemporalWorkers;
}

interface RunningWorker {
  readonly ended: Promise<unknown>;
  readonly stopping: () => boolean;
  readonly stop: () => Promise<void>;
}

export const mostCachedWorkflows = 16;

export const mostWorkflowTasksAtOnce = 2;

export const heartbeatEveryMs = 10_000;

const ranToTheEnd = Symbol('ran to the end');

const temporalWorkers: TemporalWorkers = {
  shutdownSignals: runtimeShutdownSignals,
  connect: async (settings) => {
    const connection = await NativeConnection.connect(connectionOptionsOf(settings));
    const unwatch = watchTemporal(() =>
      connection.withDeadline(Date.now() + probeEveryMs, () => connection.workflowService.getSystemInfo({})),
    );
    return {
      create: async (definition) => {
        const worker = await Worker.create({ ...definition, connection });
        return {
          run: () => worker.run(),
          shutdown: () => {
            worker.shutdown();
          },
          isRunning: () => worker.getState() === 'RUNNING',
        };
      },
      close: async () => {
        unwatch();
        await connection.close();
      },
    };
  },
};

export const runOrchestrationWorker = Effect.fnUntraced(function* (
  options: OrchestrationWorkerOptions,
): Effect.fn.Return<void, OrchestrationWorkerError, Scope.Scope> {
  const worker = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => startWorker(options, options.temporal ?? temporalWorkers),
      catch: (error) =>
        new OrchestrationWorkerError({ detail: `The orchestration worker could not start: ${String(error)}` }),
    }),
    (started) => Effect.promise(() => started.stop()),
  );
  void worker.ended.then((ending) => {
    if (ending !== ranToTheEnd || !worker.stopping()) {
      options.onFailure(failureOf(ending));
    }
    return ending;
  });
});

async function startWorker(
  { settings, executeSpec, settle, reportUnsettled, workflowBundle, ...options }: OrchestrationWorkerOptions,
  temporal: TemporalWorkers,
): Promise<RunningWorker> {
  const signals = temporal.shutdownSignals();
  if (signals.length > 0) {
    throw new Error(
      `Temporal's runtime shuts its workers down on ${signals.join(', ')}; install it with no shutdownSignals, so that the server alone handles signals`,
    );
  }
  const connection = await temporal.connect(settings);
  try {
    const worker = await connection.create({
      namespace: settings.namespace,
      taskQueue: settings.taskQueue,
      ...(workflowBundle === undefined ? { workflowsPath } : { workflowBundle: { codePath: workflowBundle } }),
      activities: makeActivities({
        executeSpec,
        settle,
        reportUnsettled,
        currentRun: () => workflowRunOf(activityInfo()),
        heartbeat: { beat: heartbeatNow, everyMs: options.heartbeatEveryMs ?? heartbeatEveryMs },
      }),
      dataConverter: { failureConverterPath },
      shutdownGraceTime: '10 seconds',
      maxCachedWorkflows: mostCachedWorkflows,
      maxConcurrentWorkflowTaskExecutions: mostWorkflowTasksAtOnce,
      maxConcurrentActivityTaskExecutions: settings.nestedExecutions,
    });
    return runningWorker(worker, connection);
  } catch (error) {
    await connection.close();
    throw error;
  }
}

function runningWorker(worker: RunnableWorker, connection: WorkerConnection): RunningWorker {
  const ended = worker.run().then(
    () => ranToTheEnd,
    (error: unknown) => error,
  );
  let stopped: Promise<void> | undefined;
  return {
    ended,
    stopping: () => stopped !== undefined,
    stop: () => {
      stopped ??= stopWorker(worker, ended, connection);
      return stopped;
    },
  };
}

async function stopWorker(
  worker: RunnableWorker,
  ended: Promise<unknown>,
  connection: WorkerConnection,
): Promise<void> {
  if (worker.isRunning()) {
    worker.shutdown();
  }
  await ended;
  await connection.close();
}

function heartbeatNow(): void {
  heartbeat();
}

function failureOf(ending: unknown): string {
  return ending === ranToTheEnd
    ? 'The orchestration worker stopped on its own'
    : `The orchestration worker stopped: ${String(ending)}`;
}
