import { Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  DefinitionSchema,
  ExecutionDetailSchema,
  ExecutionSchema,
  ListedDefinitionSchema,
  ListedRunSchema,
  ListedExecutionSchema,
  ListedSpecSchema,
  RunDetailSchema,
  RunSchema,
  SpecSchema,
  isBrainFunctionDefinition,
  isWorkflowDefinition,
  isFunctionRun,
  isWorkflowRun,
  type BrainFunctionDefinition,
  type ReasoningFunctionDefinition,
  type WorkflowDefinition,
  type FunctionRun,
  type WorkflowRun,
  type Definition,
  type Execution,
  type Run,
  type Spec,
} from '../index.ts';

const savedDefinition: Spec = {
  primitive: 'inference',
  name: 'review-campaign',
  version: 3,
  status: 'active',
  media_type: 'text/markdown',
  source: 'Keep this user-authored prompt unchanged.',
  created_at: '2026-09-01T00:00:00.000Z',
  created_by: 'author',
  updated_at: '2026-09-02T00:00:00.000Z',
};

const savedRun: Execution = {
  execution_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  primitive: 'inference',
  name: 'review-campaign',
  spec_version: 3,
  status: 'succeeded',
  output: 'The existing result.',
  started_at: '2026-09-02T00:00:00.000Z',
  started_by: 'author',
  finished_at: '2026-09-02T00:01:00.000Z',
};

describe('canonical domain names at legacy boundaries', () => {
  it('keeps supported schema exports as aliases of the canonical definitions', () => {
    expect(SpecSchema).toBe(DefinitionSchema);
    expect(ListedSpecSchema).toBe(ListedDefinitionSchema);
    expect(ListedExecutionSchema).toBe(ListedRunSchema);
    expect(ExecutionSchema).toBe(RunSchema);
    expect(ExecutionDetailSchema).toBe(RunDetailSchema);
  });

  it('reads and writes existing definitions without renaming fields or changing identity', () => {
    const definition: Definition = Schema.decodeUnknownSync(DefinitionSchema)(savedDefinition);
    expect(definition).toEqual(savedDefinition);
    expect(Schema.encodeSync(DefinitionSchema)(definition)).toEqual(savedDefinition);
  });

  it('reads and writes a historical run with the same definition version and result', () => {
    const run: Run = Schema.decodeUnknownSync(RunSchema)(savedRun);
    expect(run).toEqual(savedRun);
    expect(Schema.encodeSync(RunSchema)(run)).toEqual(savedRun);
  });

  it.each([
    { reason: 'conflict', detail: 'A tool may have changed something.', kind: 'tools_called' },
    {
      reason: 'unavailable',
      detail: 'The tool run did not finish.',
      kind: 'tools_unfinished',
      because: 'run_bound',
    },
  ])(
    'retains tool retry safeguards in a recorded rejection: $kind',
    (rejection: Readonly<{ reason: string; detail: string; kind: string; because?: string }>) => {
      const recorded = { ...savedRun, status: 'rejected', rejection };
      const run = Schema.decodeUnknownSync(RunSchema)(recorded);
      expect(run).toEqual(recorded);
      expect(Schema.encodeSync(ExecutionSchema)(run)).toEqual(recorded);
    },
  );
});

describe('scoped definitions and runs', () => {
  it('narrows stored definitions without changing their wire fields or identity', () => {
    const definition = Schema.decodeUnknownSync(DefinitionSchema)(savedDefinition);
    const workflow = { ...definition, primitive: 'orchestration', media_type: 'application/yaml' };
    const definitions = [definition, workflow];
    const functions = definitions.filter((item) => isBrainFunctionDefinition(item));
    const workflows = definitions.filter((item) => isWorkflowDefinition(item));
    expectTypeOf(functions).toEqualTypeOf<BrainFunctionDefinition[]>();
    expectTypeOf(functions).toEqualTypeOf<ReasoningFunctionDefinition[]>();
    expectTypeOf(workflows).toEqualTypeOf<WorkflowDefinition[]>();
    expect(functions).toEqual([savedDefinition]);
    expect(workflows).toEqual([workflow]);
    expect(functions[0]).toBe(definition);
    expect(workflows[0]).toBe(workflow);
    expect(functions.map((item) => Schema.encodeSync(DefinitionSchema)(item))).toEqual([savedDefinition]);
    expect(workflows.map((item) => Schema.encodeSync(DefinitionSchema)(item))).toEqual([workflow]);
  });

  it('narrows historical runs while retaining their results and version references', () => {
    const run = Schema.decodeUnknownSync(RunSchema)(savedRun);
    const workflow = { ...run, primitive: 'orchestration' };
    const runs = [run, workflow];
    const functions = runs.filter((item) => isFunctionRun(item));
    const workflows = runs.filter((item) => isWorkflowRun(item));
    expectTypeOf(functions).toEqualTypeOf<FunctionRun[]>();
    expectTypeOf(workflows).toEqualTypeOf<WorkflowRun[]>();
    expect(functions[0]).toBe(run);
    expect(workflows[0]).toBe(workflow);
    expect(functions.map((item) => Schema.encodeSync(RunSchema)(item))).toEqual([savedRun]);
    expect(workflows.map((item) => Schema.encodeSync(RunSchema)(item))).toEqual([workflow]);
  });
});

describe('extension compatibility', () => {
  it('does not classify custom adapters or planned wire values as supported resources', () => {
    for (const primitive of ['echo', 'reason', 'workflow', 'agent', 'interaction', 'prediction', 'recall', 'compute']) {
      const definition = { ...savedDefinition, primitive };
      const run = { ...savedRun, primitive };
      expect(isBrainFunctionDefinition(definition)).toBe(false);
      expect(isWorkflowDefinition(definition)).toBe(false);
      expect(isFunctionRun(run)).toBe(false);
      expect(isWorkflowRun(run)).toBe(false);
      expect(Schema.encodeSync(DefinitionSchema)(definition)).toEqual(definition);
      expect(Schema.encodeSync(RunSchema)(run)).toEqual(run);
    }
  });
});
