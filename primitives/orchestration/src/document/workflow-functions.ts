import type { CallFunctions } from '@beonauto/workflow-engine/dsl/call-functions';
import { field, isObject, type Json } from '@beonauto/workflow-engine/dsl/json';
import { policyOf } from '@beonauto/workflow-engine/dsl/policy';
import { forbidden, rejection, templateRejections, type Rejection } from '@beonauto/workflow-engine/dsl/policy-checks';
import { pointerTo } from '@beonauto/workflow-engine/dsl/tasks';

export const executeSpecFunction = 'execute_spec';

const executeSpecArguments = new Set(['primitive', 'name', 'input']);

function executeSpecRejections(arguments_: Json | undefined, pointer: string): readonly Rejection[] {
  if (!isObject(arguments_)) {
    return [rejection(pointer, `${executeSpecFunction} takes with: { primitive, name, input }`)];
  }
  const unknown = Object.keys(arguments_)
    .filter((key) => !executeSpecArguments.has(key))
    .map((key) => rejection(pointerTo(pointer, key), `${executeSpecFunction} takes no argument ${key}`));
  const missing = ['primitive', 'name']
    .filter((key) => typeof field(arguments_, key) !== 'string')
    .map((key) => rejection(pointerTo(pointer, key), `${executeSpecFunction} needs a string ${key}`));
  const workflow =
    field(arguments_, 'primitive') === 'orchestration'
      ? [forbidden(`${pointer}/primitive`, 'A workflow cannot execute another workflow in this version')]
      : [];
  return unknown.concat(missing, workflow, templateRejections(arguments_, pointer));
}

const workflowFunctions: CallFunctions = {
  argumentChecks: { [executeSpecFunction]: executeSpecRejections },
  howAWorkflowReachesTheWorld: 'a workflow reaches the world only through the specs of its brain',
  howAWorkflowStarts: 'execute the spec to run it',
};

export const workflowPolicy = policyOf(workflowFunctions);
