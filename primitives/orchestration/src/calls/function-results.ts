import type { Outcome } from '@beonauto/operations';
import { field, textField } from '@beonauto/workflow-engine';

import type { DefinitionRunResult } from './function-run.ts';

export function definitionRunResultOf(outcome: Outcome): DefinitionRunResult {
  if (outcome.status === 'rejected') {
    const { reason, detail, issues, kind, because } = outcome;
    return {
      status: 'rejected',
      reason,
      detail,
      ...(issues === undefined ? {} : { issues }),
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
    };
  }
  if (outcome.status === 'failed') {
    return { status: 'failed', detail: `The run failed with incident ${outcome.incident}` };
  }
  return textField(outcome.output, 'status') === 'succeeded'
    ? { status: 'succeeded', output: field(outcome.output, 'output') ?? null }
    : { status: 'failed', detail: 'The run finishes later, and a workflow cannot wait for it in this version' };
}
