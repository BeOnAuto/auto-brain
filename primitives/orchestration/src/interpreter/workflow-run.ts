import type { CallerIdentity } from '@beonauto/operations';
import { isJson, isList, isObject, type Json, type JsonObject } from '@beonauto/workflow-engine/dsl/json';

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
  readonly mostDuration: number;
  readonly longestNestedExecutionMs: number;
}

export type StartingRun = Omit<WorkflowRun, 'mostDuration' | 'longestNestedExecutionMs'>;

export const defaultMostDuration = 30 * 24 * 3_600_000;

export const defaultLongestNestedExecutionMs = 600_000;

const permissions = new Set(['org:read', 'org:write', 'brain:read', 'brain:write']);

export function readWorkflowRun(value: unknown): WorkflowRun | undefined {
  if (!isJson(value) || !isObject(value)) {
    return undefined;
  }
  const { document, input, execution, caller } = value;
  const limits = limitsOf(value);
  return isObject(document) &&
    input !== undefined &&
    isRunExecution(execution) &&
    isCaller(caller) &&
    limits !== undefined
    ? { document, input, execution, caller, ...limits }
    : undefined;
}

function limitsOf(value: JsonObject): Pick<WorkflowRun, 'mostDuration' | 'longestNestedExecutionMs'> | undefined {
  const { mostDuration = defaultMostDuration, longestNestedExecutionMs = defaultLongestNestedExecutionMs } = value;
  return isPositive(mostDuration) && isPositive(longestNestedExecutionMs)
    ? { mostDuration, longestNestedExecutionMs }
    : undefined;
}

function isPositive(value: Json): value is number {
  return typeof value === 'number' && value > 0;
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
