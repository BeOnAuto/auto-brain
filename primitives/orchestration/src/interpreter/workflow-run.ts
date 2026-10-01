import type { CallerIdentity } from '@beonauto/operations';

import { isJson, isList, isObject, type Json, type JsonObject } from '../dsl/json.ts';

interface RunExecution {
  readonly id: string;
  readonly org: string;
  readonly brain: string;
  readonly spec: { readonly name: string; readonly version: number };
}

export interface WorkflowRun {
  readonly document: JsonObject;
  readonly input: Json;
  readonly execution: RunExecution;
  readonly caller: CallerIdentity;
}

const permissions = new Set(['org:read', 'org:write', 'brain:read', 'brain:write']);

export function readWorkflowRun(value: unknown): WorkflowRun | undefined {
  if (!isJson(value) || !isObject(value)) {
    return undefined;
  }
  const { document, input, execution, caller } = value;
  return isObject(document) && input !== undefined && isRunExecution(execution) && isCaller(caller)
    ? { document, input, execution, caller }
    : undefined;
}

function isRunExecution(value: unknown): value is RunExecution {
  if (!isJson(value) || !isObject(value)) {
    return false;
  }
  const { id, org, brain, spec } = value;
  return (
    typeof id === 'string' &&
    typeof org === 'string' &&
    typeof brain === 'string' &&
    isObject(spec) &&
    typeof spec['name'] === 'string' &&
    typeof spec['version'] === 'number'
  );
}

function isCaller(value: unknown): value is CallerIdentity {
  if (!isJson(value) || !isObject(value)) {
    return false;
  }
  const { id, org, permissions: granted, brains } = value;
  return (
    typeof id === 'string' &&
    typeof org === 'string' &&
    isList(granted) &&
    granted.every((permission) => typeof permission === 'string' && permissions.has(permission)) &&
    isBrainAccess(brains)
  );
}

function isBrainAccess(brains: Json | undefined): boolean {
  return brains === '*' || (isList(brains) && brains.every((brain) => typeof brain === 'string'));
}
