import type { Outcome } from '@beonauto/operations';

import { field, textField } from '../dsl/json.ts';
import type { SpecExecutionResult } from './dependencies.ts';

export function specExecutionResultOf(outcome: Outcome): SpecExecutionResult {
  if (outcome.status === 'rejected') {
    const { reason, detail, issues } = outcome;
    return issues === undefined
      ? { status: 'rejected', reason, detail }
      : { status: 'rejected', reason, detail, issues };
  }
  if (outcome.status === 'failed') {
    return { status: 'failed', detail: `The execution failed with incident ${outcome.incident}` };
  }
  return textField(outcome.output, 'status') === 'succeeded'
    ? { status: 'succeeded', output: field(outcome.output, 'output') ?? null }
    : { status: 'failed', detail: 'The execution finishes later, and a workflow cannot wait for it in this version' };
}
