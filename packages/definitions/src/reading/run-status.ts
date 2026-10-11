import { declaredFactsOf, type CapabilityFacts } from '../run-work/declared-facts.ts';
import type { Run } from '../runs/run.ts';

export type RunStatus = Run['status'];

const startedTypes: readonly string[] = [
  'run_started',
  'run_deferred',
  'run_cancel_requested',
  'tool_call_started',
  'tool_call_answered',
  'tool_call_failed',
  'request_answered',
];

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
