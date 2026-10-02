import { fileURLToPath } from 'node:url';

import type { SettleExecution } from '@beonauto/specs';
import { activityInfo } from '@temporalio/activity';
import { NativeConnection, Runtime, Worker } from '@temporalio/worker';
import { Data, Effect, type Scope } from 'effect';

import type { OrchestrationActivities } from '../workflow/activity-contract.ts';
import { makeActivities, workflowRunOf } from './activities.ts';
import type { ExecuteSpec, ReportUnsettled } from './dependencies.ts';
import { connectionOptionsOf, type TemporalSettings } from './temporal-settings.ts';

export class OrchestrationWorkerError extends Data.TaggedError('OrchestrationWorkerError')<{
  readonly detail: string;
}> {}

export interface WorkerDefinition {
  readonly namespace: string;
  readonly taskQueue: string;
  readonly workflowsPath: string;
  readonly activities: OrchestrationActivities;
  readonly dataConverter: { readonly failureConverterPath: string };
  readonly shutdownGraceTime: string;
}

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
  readonly temporal?: TemporalWorkers;
}

interface RunningWorker {
  readonly ended: Promise<unknown>;
  readonly stopping: () => boolean;
  readonly stop: () => Promise<void>;
}

const workflowsPath = fileURLToPath(new URL('../workflow/workflows.ts', import.meta.url));

const failureConverterPath = fileURLToPath(new URL('failure-converter.ts', import.meta.url));

const ranToTheEnd = Symbol('ran to the end');

const temporalWorkers: TemporalWorkers = {
  shutdownSignals: runtimeShutdownSignals,
  connect: async (settings) => {
    const connection = await NativeConnection.connect(connectionOptionsOf(settings));
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
      close: () => connection.close(),
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
  { settings, executeSpec, settle, reportUnsettled }: OrchestrationWorkerOptions,
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
      workflowsPath,
      activities: makeActivities({
        executeSpec,
        settle,
        reportUnsettled,
        currentRun: () => workflowRunOf(activityInfo()),
      }),
      dataConverter: { failureConverterPath },
      shutdownGraceTime: '10 seconds',
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

function failureOf(ending: unknown): string {
  return ending === ranToTheEnd
    ? 'The orchestration worker stopped on its own'
    : `The orchestration worker stopped: ${String(ending)}`;
}

function runtimeShutdownSignals(): readonly string[] {
  if (Reflect.get(Runtime, '_instance') === undefined) {
    Runtime.install({ ...Runtime.defaultOptions, shutdownSignals: [] });
  }
  return Runtime.instance().options.shutdownSignals;
}
