import type { Execution, ExecutionAddress, SettleExecution, Settlement } from '@beonauto/specs';
import { Client, Connection } from '@temporalio/client';
import { Effect, Exit, Scope } from 'effect';
import { inject } from 'vitest';

import { connectOrchestration, type OrchestrationClient } from '../primitive/orchestration-client.ts';
import type { ExecuteSpec, SpecExecution, SpecExecutionResult, UnsettledExecution } from '../worker/dependencies.ts';
import { runOrchestrationWorker } from '../worker/orchestration-worker.ts';
import type { TemporalSettings } from '../worker/temporal-settings.ts';
import { failureRecorder } from './failure-recorder.ts';
import { temporalLogsOf } from './temporal-logs.ts';

interface Settled {
  readonly address: ExecutionAddress;
  readonly settlement: Settlement;
}

export interface TemporalHarness {
  readonly settings: TemporalSettings;
  readonly orchestration: OrchestrationClient;
  readonly temporal: Client;
  readonly executions: () => readonly SpecExecution[];
  readonly settled: () => readonly Settled[];
  readonly unsettled: () => readonly UnsettledExecution[];
  readonly temporalLogsOf: typeof temporalLogsOf;
  readonly close: () => Promise<void>;
}

export interface HarnessOptions {
  readonly respond?: (execution: SpecExecution) => SpecExecutionResult;
  readonly answerWhen?: () => Promise<void>;
  readonly settle?: SettleExecution;
  readonly nestedExecutions?: number;
  readonly heartbeatEveryMs?: number;
  readonly workflowBundle?: string;
}

export function settingsFor(taskQueue: string, nestedExecutions = 32): TemporalSettings {
  return {
    address: inject('temporalAddress'),
    namespace: 'default',
    taskQueue,
    tls: false,
    mostDuration: 2_592_000_000,
    nestedExecutions,
  };
}

function answerAtOnce(): Promise<void> {
  return Promise.resolve();
}

export function settledExecution(address: ExecutionAddress, settlement: Settlement): Execution {
  const finished = { primitive: 'orchestration', name: 'test-flow', spec_version: 1, started_at: '', started_by: '' };
  return settlement.status === 'succeeded'
    ? { execution_id: address.id, ...finished, status: 'succeeded', output: settlement.output }
    : { execution_id: address.id, ...finished, status: settlement.status === 'failed' ? 'failed' : 'rejected' };
}

export async function temporalHarness(taskQueue: string, options: HarnessOptions = {}): Promise<TemporalHarness> {
  const executions: SpecExecution[] = [];
  const settled: Settled[] = [];
  const settings = settingsFor(taskQueue, options.nestedExecutions);
  const respond = options.respond ?? ((): SpecExecutionResult => ({ status: 'succeeded', output: null }));
  const answerWhen = options.answerWhen ?? answerAtOnce;
  const executeSpec: ExecuteSpec = (execution) =>
    Effect.sync(() => {
      executions.push(execution);
    }).pipe(Effect.andThen(Effect.promise(answerWhen)), Effect.andThen(Effect.sync(() => respond(execution))));
  const settle: SettleExecution =
    options.settle ??
    ((address, settlement) =>
      Effect.sync(() => {
        settled.push({ address, settlement });
        return settledExecution(address, settlement);
      }));
  const recorder = failureRecorder();
  const scope = Effect.runSync(Scope.make());
  const orchestration = await Effect.runPromise(
    Effect.gen(function* () {
      yield* runOrchestrationWorker({
        settings,
        executeSpec,
        settle,
        onFailure: recorder.onFailure,
        reportUnsettled: recorder.reportUnsettled,
        ...(options.heartbeatEveryMs === undefined ? {} : { heartbeatEveryMs: options.heartbeatEveryMs }),
        ...(options.workflowBundle === undefined ? {} : { workflowBundle: options.workflowBundle }),
      });
      return yield* connectOrchestration(settings, { requestTimeout: 5000 });
    }).pipe(Scope.provide(scope)),
  );
  const connection = await Connection.connect({ address: settings.address });
  return {
    settings,
    orchestration,
    temporal: new Client({ connection }),
    executions: () => executions,
    settled: () => settled,
    unsettled: recorder.unsettled,
    temporalLogsOf,
    close: async () => {
      await connection.close();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
