import type { Execution, ExecutionAddress, SettleExecution, Settlement } from '@beonauto/specs';
import { Client, Connection } from '@temporalio/client';
import { DefaultLogger, Runtime } from '@temporalio/worker';
import { Effect, Exit, Scope } from 'effect';
import { inject } from 'vitest';

import { connectOrchestration, type OrchestrationClient } from '../primitive/orchestration-client.ts';
import type { ExecuteSpec, SpecExecution, SpecExecutionResult, UnsettledExecution } from '../worker/dependencies.ts';
import { runOrchestrationWorker } from '../worker/orchestration-worker.ts';
import type { TemporalSettings } from '../worker/temporal-settings.ts';
import { failureRecorder } from './failure-recorder.ts';

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
  readonly close: () => Promise<void>;
}

export interface HarnessOptions {
  readonly respond?: (execution: SpecExecution) => SpecExecutionResult;
  readonly settle?: SettleExecution;
}

Runtime.install({ logger: new DefaultLogger('WARN'), shutdownSignals: [] });

export function settingsFor(taskQueue: string): TemporalSettings {
  return {
    address: inject('temporalAddress'),
    namespace: 'default',
    taskQueue,
    tls: false,
    mostDuration: 2_592_000_000,
  };
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
  const settings = settingsFor(taskQueue);
  const respond = options.respond ?? ((): SpecExecutionResult => ({ status: 'succeeded', output: null }));
  const executeSpec: ExecuteSpec = (execution) =>
    Effect.sync(() => {
      executions.push(execution);
      return respond(execution);
    });
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
    close: async () => {
      await connection.close();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
