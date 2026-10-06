import type { AppRuntime } from '@beonauto/api';
import { Ledger, type Dispatcher, type DispatcherServices } from '@beonauto/operations';
import { orchestrationMachine, specCalls, specExecutionResultOf, type ExecuteSpec } from '@beonauto/orchestration';
import {
  defineExecuteSpec,
  executionSettler,
  type BrainOperation,
  type Primitive,
  type SettleExecution,
} from '@beonauto/specs';
import { openWorkflowHost, type DatabaseSettings, type HostReports, type WorkflowHost } from '@beonauto/workflow-host';
import { Effect, Exit, Redacted } from 'effect';

import { logHostNote } from '../logging/host-notes.ts';
import { logLostWorkflowConnection, logUnsettled, logWorkflows, logWorkflowTrouble } from '../logging/logging.ts';
import type { LedgerSettings } from '../settings/ledger-settings.ts';
import type { WorkflowSettings } from '../settings/workflow-settings.ts';

export interface HostParts {
  readonly ledger: LedgerSettings;
  readonly workflows: WorkflowSettings;
  readonly primitives: readonly Primitive[];
}

const unsettledBecause = {
  unknown_execution: 'The ledger has no such execution',
  settled_otherwise: 'The execution was settled otherwise before',
} as const;

export function inRuntime<A, E>(
  runtime: AppRuntime<DispatcherServices>,
  work: Effect.Effect<A, E, DispatcherServices>,
): Effect.Effect<A, E> {
  return Effect.gen(function* () {
    const ran = yield* Effect.promise((signal) => runtime.run(Effect.exit(work), signal));
    if (!Exit.isExit(ran)) {
      return yield* Effect.die(new Error('The server stopped before the work could be done'));
    }
    return yield* ran;
  });
}

function nestedExecutions(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  executeSpec: BrainOperation,
): ExecuteSpec {
  return ({ org, brain, caller, primitive, name, input, executionId }) =>
    inRuntime(
      runtime,
      dispatcher.dispatchToBrain(executeSpec.registration, {
        caller,
        org,
        brain,
        input: { primitive, name, input, execution_id: executionId },
        encoding: 'json',
      }),
    ).pipe(Effect.map(specExecutionResultOf));
}

function settlements(runtime: AppRuntime<DispatcherServices>): SettleExecution {
  return (execution, settlement) =>
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (ledger) => executionSettler(ledger)(execution, settlement)),
    );
}

export function hostReports(runtime: AppRuntime<DispatcherServices>): HostReports {
  return {
    unsettled: ({ org, brain, executionId, receipt }) =>
      inRuntime(runtime, logUnsettled({ org, brain, executionId, reason: unsettledBecause[receipt] })),
    trouble: (what, cause) => inRuntime(runtime, logWorkflowTrouble(what, cause)),
    lostConnection: (error) => {
      void runtime.run(logLostWorkflowConnection(error));
    },
    note: (note) => inRuntime(runtime, logHostNote(note)),
  };
}

export function hostDatabaseOf(ledger: LedgerSettings): DatabaseSettings {
  return ledger.store === 'sqlite'
    ? { store: 'sqlite', file: ledger.file }
    : { store: 'postgresql', connectionString: Redacted.value(ledger.url) };
}

export async function openedHost(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { ledger, workflows, primitives }: HostParts,
): Promise<WorkflowHost> {
  const host = await openWorkflowHost({
    database: hostDatabaseOf(ledger),
    machine: orchestrationMachine,
    perform: specCalls(nestedExecutions(runtime, dispatcher, defineExecuteSpec(primitives))),
    settle: settlements(runtime),
    reports: hostReports(runtime),
    sweepEveryMs: workflows.sweepEveryMs,
    mostCallsAtOnce: workflows.mostCallsAtOnce,
  });
  await runtime.run(logWorkflows(workflows));
  return host;
}
