import type { CallFunctions } from '../dsl/call-functions.ts';
import { isObject, type Json, type JsonObject } from '../dsl/json.ts';
import { rejection, templateRejections } from '../dsl/policy-checks.ts';
import type { RunLimits, Started } from '../machine/run-input.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';

export interface StartRequest {
  readonly executionId: string;
  readonly document: JsonObject;
  readonly input?: Json;
  readonly limits?: Partial<RunLimits>;
  readonly attributes?: JsonObject;
  readonly seed?: number;
}

export const testFunctions: CallFunctions = {
  argumentChecks: {
    notify: (arguments_, pointer) =>
      isObject(arguments_)
        ? templateRejections(arguments_, pointer)
        : [rejection(pointer, 'notify takes with: { to }')],
  },
  describe: (name) => `the function ${name}`,
  howAWorkflowReachesTheWorld: 'a workflow reaches the world only through the functions it is given',
  howAWorkflowStarts: 'start it through its runtime',
};

export const testRuntime: JsonObject = { name: 'workflow-engine', version: '1', metadata: {} };

export const testMachine: MachineOptions = { functions: testFunctions, runtime: testRuntime };

export const defaultLimits: RunLimits = { mostDurationMs: 2_592_000_000, longestCallMs: 600_000 };

export const defaultSeed = 7;

export function startedOf(request: StartRequest, at: number): Started {
  const { executionId, document, input = {}, limits = {}, attributes = {}, seed = defaultSeed } = request;
  return {
    kind: 'started',
    executionId,
    at,
    document,
    input,
    limits: { ...defaultLimits, ...limits },
    attributes,
    seed,
  };
}
