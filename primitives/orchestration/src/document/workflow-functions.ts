import { definitionResourceLabel, emittedEventRefusal, isReservedSource, reservedEventTypes } from '@beonauto/specs';
import {
  type CallFunctions,
  field,
  isObject,
  type Json,
  type JsonObject,
  pointerTo,
  policyOf,
  type Rejection,
  rejection,
  templateRejections,
  textField,
} from '@beonauto/workflow-engine';

import { scheduleRejections } from './workflow-schedule.ts';

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
  return unknown.concat(missing, templateRejections(arguments_, pointer));
}

function specDescribed(name: string, arguments_: Json): string {
  const primitive = isObject(arguments_) ? textField(arguments_, 'primitive') : undefined;
  const spec = isObject(arguments_) ? textField(arguments_, 'name') : undefined;
  return primitive === undefined || spec === undefined ? name : `the ${definitionResourceLabel(primitive)} ${spec}`;
}

function emitRejections(attributes: JsonObject, pointer: string): readonly Rejection[] {
  const type = field(attributes, 'type');
  const source = field(attributes, 'source');
  const reservedType =
    typeof type === 'string' && reservedEventTypes.has(type)
      ? [
          rejection(
            `${pointer}/type`,
            `The type ${type} is one the brain records itself; give the event a type of your own`,
          ),
        ]
      : [];
  const reservedSource =
    typeof source === 'string' && isReservedSource(source)
      ? [
          rejection(
            `${pointer}/source`,
            `The source ${source} is one the brain records itself; give the event a source of your own`,
          ),
        ]
      : [];
  return reservedType.concat(reservedSource);
}

function emitRefusal(event: JsonObject): string | undefined {
  const refusal = emittedEventRefusal(event);
  return refusal === undefined ? undefined : `The event to emit is not one the brain takes: ${refusal}`;
}

export const workflowFunctions: CallFunctions = {
  argumentChecks: { [executeSpecFunction]: executeSpecRejections },
  describe: specDescribed,
  emitRejections,
  emitRefusal,
  scheduleRejections,
  howAWorkflowReachesTheWorld: 'a workflow reaches the world only through its brain functions',
  howAWorkflowStarts: 'run the workflow with execute_spec',
};

export const workflowPolicy = policyOf(workflowFunctions);
