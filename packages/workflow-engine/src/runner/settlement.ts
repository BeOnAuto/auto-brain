import type { Settlement } from '@beonauto/operations';

import { describeError, rejectionReasonOf } from '../dsl/raised-error.ts';
import type { RunOutcome } from '../machine/run-state.ts';

export function settlementOf(outcome: RunOutcome): Settlement {
  if (outcome.kind === 'completed') {
    return { status: 'succeeded', output: outcome.output };
  }
  return outcome.kind === 'raised'
    ? { status: 'rejected', reason: rejectionReasonOf(outcome.error), detail: describeError(outcome.error) }
    : { status: 'failed' };
}
