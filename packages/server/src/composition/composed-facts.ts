import type { AppRuntime } from '@beonauto/api';
import { workflowFacts } from '@beonauto/coordination';
import {
  brainOwnNamesOf,
  declaredFactsOf,
  runFactsOf,
  workRecorder,
  type BrainOwnNames,
  type Capability,
  type RecordWork,
} from '@beonauto/definitions';
import type { DispatcherServices } from '@beonauto/operations';

import { runtimeLedger } from './runtime-ledger.ts';

export interface ComposedFacts {
  readonly names: BrainOwnNames;
  readonly record: RecordWork;
}

export function factsComposedOf(
  runtime: AppRuntime<DispatcherServices>,
  capabilities: readonly Capability[],
): ComposedFacts {
  const declarations = [...capabilities, { facts: workflowFacts }];
  return {
    names: brainOwnNamesOf(declarations),
    record: workRecorder(runtimeLedger(runtime), runFactsOf(declaredFactsOf(declarations))),
  };
}
