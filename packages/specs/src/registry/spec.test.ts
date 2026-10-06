import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  isBrainFunctionDefinition,
  isWorkflowDefinition,
  type BrainFunctionDefinition,
  type Definition,
  type WorkflowDefinition,
} from '../index.ts';

const reasoningFunction: Definition = {
  primitive: 'inference',
  name: 'review-campaign',
  version: 3,
  status: 'active',
  media_type: 'text/markdown',
  source: 'Review the brief against the criteria.',
  created_at: '2026-09-01T00:00:00.000Z',
  created_by: 'author',
  updated_at: '2026-09-02T00:00:00.000Z',
};

const computationFunction: Definition = { ...reasoningFunction, primitive: 'computation', source: '.a + 1' };

const workflow: Definition = { ...reasoningFunction, primitive: 'orchestration', media_type: 'application/yaml' };

describe('a saved definition', () => {
  it('is a brain function when it is a reasoning or a computation function, and a workflow when it is a workflow', () => {
    const definitions = [reasoningFunction, computationFunction, workflow];

    const functions = definitions.filter((definition) => isBrainFunctionDefinition(definition));
    const workflows = definitions.filter((definition) => isWorkflowDefinition(definition));

    expectTypeOf(functions).toEqualTypeOf<BrainFunctionDefinition[]>();
    expectTypeOf(workflows).toEqualTypeOf<WorkflowDefinition[]>();
    expect([functions, workflows]).toEqual([[reasoningFunction, computationFunction], [workflow]]);
  });

  it.each(['echo', 'reason', 'workflow', 'interaction', 'prediction', 'recall', 'compute'])(
    'is neither of a custom adapter or a planned function type: %s',
    (primitive) => {
      const definition = { ...reasoningFunction, primitive };

      expect([isBrainFunctionDefinition(definition), isWorkflowDefinition(definition)]).toEqual([false, false]);
    },
  );
});
