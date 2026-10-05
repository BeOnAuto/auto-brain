import type { Json, JsonObject } from '../dsl/json.ts';
import type { RunLimits, Started } from '../machine/run-input.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { testFunctions } from './workflows.ts';

export interface StartRequest {
  readonly executionId: string;
  readonly document: JsonObject;
  readonly input?: Json;
  readonly limits?: Partial<RunLimits>;
  readonly attributes?: JsonObject;
  readonly seed?: number;
}

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
