import { declaredFactsOf, type CapabilityFacts } from '../run-work/declared-facts.ts';
import { coreRunFactTypes, isRunEndingType } from '../runs/run-events.ts';
import type { Run } from '../runs/run.ts';

export type RunStatus = Run['status'];

const startedTypes: readonly string[] = coreRunFactTypes.filter((type) => !isRunEndingType(type));

export function storedTypesByStatus(
  capabilities: readonly { readonly facts: CapabilityFacts }[],
): Readonly<Record<RunStatus, readonly string[]>> {
  return {
    started: [...startedTypes, ...declaredFactsOf(capabilities).map(({ type }) => type)],
    succeeded: ['run_succeeded'],
    rejected: ['run_rejected'],
    failed: ['run_failed'],
  };
}
