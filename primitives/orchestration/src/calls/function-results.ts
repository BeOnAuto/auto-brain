import type { Outcome } from '@beonauto/operations';
import type { RunEnding } from '@beonauto/specs';
import { field, textField } from '@beonauto/workflow-engine';

import type { DefinitionRunResult, EndedRunResult } from './function-run.ts';

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
    : { status: 'waiting' };
}

export function endedRunResultOf(ending: RunEnding): EndedRunResult {
  if (ending.type === 'execution_succeeded') {
    return { status: 'succeeded', output: ending.output };
  }
  if (ending.type === 'execution_failed') {
    return {
      status: 'failed',
      detail: ending.incident === undefined ? 'The run failed' : `The run failed with incident ${ending.incident}`,
    };
  }
  return { status: 'rejected', ...ending.rejection };
}
