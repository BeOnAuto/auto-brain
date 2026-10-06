import { textField, type ChildCall } from '@beonauto/workflow-engine';

import { isArgumentsProblem, specArgumentsOf } from '../document/spec-arguments.ts';
import { executeSpecFunction } from '../document/workflow-functions.ts';
import { nestedExecutionId } from './nested-execution-id.ts';

export function childRunOf({
  function: name,
  reference,
  run,
  arguments: given,
  attributes,
}: ChildCall): string | undefined {
  const workflow = textField(attributes, 'execution_id');
  if (name !== executeSpecFunction || workflow === undefined || isArgumentsProblem(specArgumentsOf(given))) {
    return undefined;
  }
  return nestedExecutionId(workflow, reference, run);
}
