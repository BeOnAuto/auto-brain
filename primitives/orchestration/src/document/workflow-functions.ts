import {
  type CallFunctions,
  field,
  forbidden,
  isObject,
  type Json,
  pointerTo,
  policyOf,
  type Rejection,
  rejection,
  templateRejections,
  textField,
} from '@beonauto/workflow-engine';

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

function specDescribed(name: string, arguments_: Json): string {
  const primitive = isObject(arguments_) ? textField(arguments_, 'primitive') : undefined;
  const spec = isObject(arguments_) ? textField(arguments_, 'name') : undefined;
  return primitive === undefined || spec === undefined ? name : `the ${primitive} spec ${spec}`;
}

export const workflowFunctions: CallFunctions = {
  argumentChecks: { [executeSpecFunction]: executeSpecRejections },
  describe: specDescribed,
  howAWorkflowReachesTheWorld: 'a workflow reaches the world only through its brain functions',
  howAWorkflowStarts: 'run the workflow with execute_spec',
};

export const workflowPolicy = policyOf(workflowFunctions);
