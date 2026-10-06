import { startedAt as workflowStartedAt } from '@beonauto/workflow-engine/testing';
import { describe, expect, it } from 'vitest';

import { executionId, interpret, workflow } from '../testing/workflows.ts';

describe('the data of a task', () => {
  it('flows from the output of one task into the input of the next', async () => {
    const document = workflow(`
do:
  - first:
      set: { count: 1 }
  - second:
      set: { count: '\${ .count + 1 }' }
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { count: 2 } });
  });

  it('is shaped by input.from before the task and output.as after it', async () => {
    const document = workflow(`
do:
  - shaped:
      input:
        from: .order
      set: { total: '\${ .price * .quantity }' }
      output:
        as: '\${ { total: .total, quantity: $input.quantity } }'
`);

    expect((await interpret(document, { input: { order: { price: 3, quantity: 4 } } })).ending).toEqual({
      kind: 'completed',
      output: { total: 12, quantity: 4 },
    });
  });

  it('can be set from one expression', async () => {
    const document = workflow(`
do:
  - pick:
      set: .items[1]
`);

    expect((await interpret(document, { input: { items: ['a', 'b'] } })).ending).toEqual({
      kind: 'completed',
      output: 'b',
    });
  });
});

describe('the context of a workflow', () => {
  it('is replaced by what a task exports, seeing its output and the context before it', async () => {
    const document = workflow(`
do:
  - count:
      set: { seen: 1 }
      export:
        as: '\${ $context + { first: $output.seen } }'
  - again:
      set: { seen: 2 }
      export:
        as: '\${ $context + { second: .seen } }'
  - report:
      set: '\${ $context }'
`);

    expect((await interpret(document)).ending).toEqual({ kind: 'completed', output: { first: 1, second: 2 } });
  });
});

describe('the descriptors a task sees', () => {
  it('describe the task, with its raw input and its output after it ran', async () => {
    const document = workflow(`
do:
  - describe:
      input:
        from: '\${ { wrapped: . } }'
      set: { name: '\${ $task.name }', reference: '\${ $task.reference }', raw: '\${ $task.input }' }
      output:
        as: '\${ . + { output: $task.output.name, at: $task.startedAt.epoch.milliseconds } }'
`);

    expect((await interpret(document, { input: 5 })).ending).toEqual({
      kind: 'completed',
      output: { name: 'describe', reference: '/do/0/describe', raw: 5, output: 'describe', at: workflowStartedAt },
    });
  });

  it('describe the workflow and the runtime', async () => {
    const document = workflow(`
do:
  - describe:
      set: { id: '\${ $workflow.id }', input: '\${ $workflow.input }', runtime: '\${ $runtime.metadata.primitive }' }
`);

    expect((await interpret(document, { input: [1] })).ending).toEqual({
      kind: 'completed',
      output: { id: executionId, input: [1], runtime: 'orchestration' },
    });
  });
});

describe('a task guarded by if', () => {
  it('runs when its guard holds on the raw input, and is skipped otherwise', async () => {
    const document = workflow(`
do:
  - large:
      if: .size > 10
      set: { label: large }
  - small:
      if: '\${ .size <= 10 }'
      set: { label: small }
`);

    expect((await interpret(document, { input: { size: 3 } })).ending).toEqual({
      kind: 'completed',
      output: { label: 'small' },
    });
  });
});

describe('the bodies of tasks', () => {
  it('raise a configuration error for a task of no type', async () => {
    expect((await interpret(workflow('do:\n  - dance: { tango: true }'))).settlement).toMatchObject({
      detail: 'The task has no type this runtime knows (at /do/0/dance)',
    });
  });
});
