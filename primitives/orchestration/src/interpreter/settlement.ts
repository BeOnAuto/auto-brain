import type { Json } from '../dsl/json.ts';
import type { RunSettlement } from './host.ts';
import { describeError, type DslError } from './raised-error.ts';

export type RunOutcome =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'raised'; readonly error: DslError }
  | { readonly kind: 'cancelled'; readonly cause: unknown }
  | { readonly kind: 'broken'; readonly reason: string };

export type WorkflowEnding =
  | { readonly kind: 'completed'; readonly output: Json }
  | { readonly kind: 'failed'; readonly type: string; readonly message: string }
  | { readonly kind: 'cancelled'; readonly cause: unknown };

const retryableStatuses = new Set([408, 429]);

export function rejectionReasonOf({ status }: DslError): 'invalid_input' | 'unavailable' {
  return status >= 400 && status < 500 && !retryableStatuses.has(status) ? 'invalid_input' : 'unavailable';
}

export function settlementOf(outcome: RunOutcome): RunSettlement {
  if (outcome.kind === 'completed') {
    return { status: 'succeeded', output: outcome.output };
  }
  return outcome.kind === 'raised'
    ? { status: 'rejected', reason: rejectionReasonOf(outcome.error), detail: describeError(outcome.error) }
    : { status: 'failed' };
}

export function endingOf(outcome: RunOutcome): WorkflowEnding {
  if (outcome.kind === 'raised') {
    return { kind: 'failed', type: 'UncaughtError', message: describeError(outcome.error) };
  }
  return outcome.kind === 'broken' ? { kind: 'failed', type: 'WorkflowBrokeDown', message: outcome.reason } : outcome;
}
