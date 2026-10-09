import { textField, type ChildCall } from '@beonauto/workflow-engine';

import { isArgumentsProblem, definitionArgumentsOf } from '../document/definition-arguments.ts';
import { runDefinitionFunction } from '../document/workflow-functions.ts';
import { nestedRunId } from './nested-run-id.ts';

export function childRunOf({
  function: name,
  reference,
  run,
  arguments: given,
  attributes,
}: ChildCall): string | undefined {
  const workflow = textField(attributes, 'run_id');
  if (name !== runDefinitionFunction || workflow === undefined || isArgumentsProblem(definitionArgumentsOf(given))) {
    return undefined;
  }
  return nestedRunId(workflow, reference, run);
}
