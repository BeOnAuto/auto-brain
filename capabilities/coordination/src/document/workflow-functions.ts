import {
  definitionResourceLabel,
  emittedEventRefusal,
  isReservedSource,
  reservedEventTypes,
} from '@beonauto/definitions';
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
  textField,
} from '@beonauto/workflow-engine';

import { scheduleRejections } from './workflow-schedule.ts';

export const runDefinitionFunction = 'run_definition';

const runDefinitionArguments = new Set(['type', 'name', 'input']);

function runDefinitionRejections(arguments_: Json | undefined, pointer: string): readonly Rejection[] {
  if (!isObject(arguments_)) {
    return [rejection(pointer, `${runDefinitionFunction} takes with: { type, name, input }`)];
  }
  const unknown = Object.keys(arguments_)
    .filter((key) => !runDefinitionArguments.has(key))
    .map((key) => rejection(pointerTo(pointer, key), `${runDefinitionFunction} takes no argument ${key}`));
  const missing = ['type', 'name']
    .filter((key) => typeof field(arguments_, key) !== 'string')
    .map((key) => rejection(pointerTo(pointer, key), `${runDefinitionFunction} needs a string ${key}`));
  return unknown.concat(missing);
}

function definitionDescribed(name: string, arguments_: Json): string {
  const type = isObject(arguments_) ? textField(arguments_, 'type') : undefined;
  const definition = isObject(arguments_) ? textField(arguments_, 'name') : undefined;
  return type === undefined || definition === undefined ? name : `the ${definitionResourceLabel(type)} ${definition}`;
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
  argumentChecks: { [runDefinitionFunction]: runDefinitionRejections },
  describe: definitionDescribed,
  emitRejections,
  emitRefusal,
  scheduleRejections,
  howAWorkflowReachesTheWorld: 'a workflow reaches the world only through its brain functions',
  howAWorkflowStarts: 'run the workflow with run_definition',
};

export const workflowPolicy = policyOf(workflowFunctions);
