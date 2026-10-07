import type { AppRuntime } from '@beonauto/api';
import { Ledger, type Dispatcher, type DispatcherServices } from '@beonauto/operations';
import {
  callResultOfEnding,
  definitionCalls,
  definitionRunResultOf,
  orchestrationMachine,
  type RunDefinition,
} from '@beonauto/orchestration';
import {
  defineExecuteSpec,
  deferredCanceller,
  executionCanceller,
  executionSettler,
  type BrainOperation,
  type Primitive,
  type SettleExecution,
} from '@beonauto/specs';
import type { HostOptions, WaitingOptions } from '@beonauto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from './in-runtime.ts';
import { reactionsOf } from './reaction-dependencies.ts';

export type HostWork = Pick<HostOptions, 'machine' | 'perform' | 'settle' | 'reactions' | 'waiting'>;

export interface WorkParts {
  readonly primitives: readonly Primitive[];
  readonly startVersion: BrainOperation;
}

function nestedExecutions(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  executeSpec: BrainOperation,
): RunDefinition {
  return ({ org, brain, caller, primitive, name, input, executionId, lineage, depth, callDepth, calledBy }) =>
    inRuntime(
      runtime,
      dispatcher.dispatchToBrain(executeSpec.registration, {
        caller,
        org,
        brain,
        input: { primitive, name, input, execution_id: executionId },
        encoding: 'json',
        lineage,
        depth,
        callDepth,
        calledBy,
      }),
    ).pipe(Effect.map(definitionRunResultOf));
}

function settlements(runtime: AppRuntime<DispatcherServices>): SettleExecution {
  return (execution, settlement, lineage) =>
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (ledger) => executionSettler(ledger)(execution, settlement, lineage)),
    );
}

function waitingOf(runtime: AppRuntime<DispatcherServices>, primitives: readonly Primitive[]): WaitingOptions {
  return {
    resultOf: callResultOfEnding,
    cancel: (execution, request, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) => executionCanceller(ledger)(execution, request, lineage)),
      ),
    cancelDeferred: (execution, request, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) =>
          deferredCanceller(primitives, ledger)(execution, request, lineage),
        ),
      ),
  };
}

export function hostWorkOf(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { primitives, startVersion }: WorkParts,
): HostWork {
  return {
    machine: orchestrationMachine,
    perform: definitionCalls(nestedExecutions(runtime, dispatcher, defineExecuteSpec(primitives))),
    settle: settlements(runtime),
    reactions: reactionsOf(runtime, dispatcher, startVersion),
    waiting: waitingOf(runtime, primitives),
  };
}
