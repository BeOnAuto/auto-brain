import type { AppRuntime } from '@beonauto/api';
import {
  callResultOfEnding,
  definitionCalls,
  definitionRunResultOf,
  workflowMachineOptions,
  type RunDefinition,
} from '@beonauto/coordination';
import {
  defineRunDefinition,
  deferredCanceller,
  runCanceller,
  runSettler,
  type BrainOperation,
  type Capability,
  type SettleRun,
} from '@beonauto/definitions';
import { Ledger, type Dispatcher, type DispatcherServices } from '@beonauto/operations';
import type { HostOptions, WaitingOptions } from '@beonauto/workflow-host';
import { Effect } from 'effect';

import { inRuntime } from './in-runtime.ts';
import { reactionsOf } from './reaction-dependencies.ts';

export type HostWork = Pick<HostOptions, 'machine' | 'perform' | 'settle' | 'reactions' | 'waiting'>;

export interface WorkParts {
  readonly capabilities: readonly Capability[];
  readonly startVersion: BrainOperation;
}

function nestedRuns(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  runDefinition: BrainOperation,
): RunDefinition {
  return ({ org, brain, caller, type, name, input, runId, lineage, depth, callDepth, calledBy }) =>
    inRuntime(
      runtime,
      dispatcher.dispatchToBrain(runDefinition.registration, {
        caller,
        org,
        brain,
        input: { type, name, input, run_id: runId },
        encoding: 'json',
        lineage,
        depth,
        callDepth,
        calledBy,
      }),
    ).pipe(Effect.map(definitionRunResultOf));
}

function settlements(runtime: AppRuntime<DispatcherServices>): SettleRun {
  return (run, settlement, lineage) =>
    inRuntime(
      runtime,
      Effect.flatMap(Effect.service(Ledger), (ledger) => runSettler(ledger)(run, settlement, lineage)),
    );
}

function waitingOf(runtime: AppRuntime<DispatcherServices>, capabilities: readonly Capability[]): WaitingOptions {
  return {
    resultOf: callResultOfEnding,
    cancel: (run, request, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) => runCanceller(ledger)(run, request, lineage)),
      ),
    cancelDeferred: (run, request, lineage) =>
      inRuntime(
        runtime,
        Effect.flatMap(Effect.service(Ledger), (ledger) =>
          deferredCanceller(capabilities, ledger)(run, request, lineage),
        ),
      ),
  };
}

export function hostWorkOf(
  runtime: AppRuntime<DispatcherServices>,
  dispatcher: Dispatcher,
  { capabilities, startVersion }: WorkParts,
): HostWork {
  return {
    machine: workflowMachineOptions,
    perform: definitionCalls(nestedRuns(runtime, dispatcher, defineRunDefinition(capabilities))),
    settle: settlements(runtime),
    reactions: reactionsOf(runtime, dispatcher, startVersion),
    waiting: waitingOf(runtime, capabilities),
  };
}
