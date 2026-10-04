import { Schema } from 'effect';
import { parse } from 'yaml';

import type { CallFunctions } from '../dsl/call-functions.ts';
import { isObject, type JsonObject } from '../dsl/json.ts';
import { rejection, templateRejections } from '../dsl/policy-checks.ts';

export const header = { dsl: '1.0.3', namespace: 'acme', name: 'test', version: '1.0.0' };

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);

export function yamlObject(source: string): JsonObject {
  return decodeObject(parse(source));
}

export const testFunctions: CallFunctions = {
  argumentChecks: {
    notify: (arguments_, pointer) =>
      isObject(arguments_)
        ? templateRejections(arguments_, pointer)
        : [rejection(pointer, 'notify takes with: { to }')],
  },
  howAWorkflowReachesTheWorld: 'a workflow reaches the world only through the functions it is given',
  howAWorkflowStarts: 'start it through its runtime',
};

export function workflow(source: string): JsonObject {
  return { document: header, ...yamlObject(source) };
}
