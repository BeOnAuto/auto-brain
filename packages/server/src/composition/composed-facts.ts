import type { AppRuntime } from '@beonauto/api';
import { workflowFacts } from '@beonauto/coordination';
import {
  playbookOwnNamesOf,
  composedFactsOf,
  runFactsOf,
  workRecorder,
  type PlaybookOwnNames,
  type Capability,
  type CapabilityFacts,
  type RecordWork,
} from '@beonauto/definitions';
import type { DispatcherServices } from '@beonauto/operations';

import { runtimeLedger } from './runtime-ledger.ts';

export interface ComposedFacts {
  readonly facts: CapabilityFacts;
  readonly names: PlaybookOwnNames;
  readonly record: RecordWork;
}

export function factsComposedOf(
  runtime: AppRuntime<DispatcherServices>,
  capabilities: readonly Capability[],
): ComposedFacts {
  const declarations = [...capabilities, workflowFacts];
  const facts = composedFactsOf(declarations);
  return {
    facts,
    names: playbookOwnNamesOf(declarations, facts),
    record: workRecorder(runtimeLedger(runtime), runFactsOf(facts.onRuns)),
  };
}
