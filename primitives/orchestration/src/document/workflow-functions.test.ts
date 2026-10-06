import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';
import { workflowFunctions, workflowPolicy } from './workflow-functions.ts';

function rejectedIn(tasks: string): readonly string[] {
  return workflowPolicy(workflow(`do:\n${tasks}`)).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

describe('the functions a workflow calls', () => {
  it('are execute_spec alone: a workflow reaches the world through the specs of its brain', () => {
    expect(
      rejectedIn(`
  - fetch: { call: http, with: {} }
  - log: { call: log, with: {} }
`),
    ).toEqual([
      '/do/0/fetch/call: call: http is not allowed: a workflow reaches the world only through its brain functions; call execute_spec',
      '/do/1/log/call: call: log names no function; the one function is execute_spec',
    ]);
  });

  it('are named when a document brings catalogs or functions, or a schedule', () => {
    expect(
      workflowPolicy(workflow('schedule: { every: PT1H }\nuse: { catalogs: {}, functions: {} }\ndo: []')).map(
        ({ detail }) => detail,
      ),
    ).toEqual([
      'catalogs are not supported in this version: a workflow calls only execute_spec',
      'reusable functions are not supported in this version: call execute_spec directly',
      'schedules are not supported in this version: run the workflow with execute_spec',
    ]);
  });
});

describe('a call of execute_spec', () => {
  it('is described by the definition it runs, or by its name when that cannot be read', () => {
    expect([
      workflowFunctions.describe('execute_spec', { primitive: 'inference', name: 'summarize' }),
      workflowFunctions.describe('execute_spec', { primitive: 'echo', name: 'greet' }),
      workflowFunctions.describe('execute_spec', { name: 'summarize' }),
      workflowFunctions.describe('execute_spec', 'summarize'),
    ]).toEqual(['the reasoning function summarize', 'the echo definition greet', 'execute_spec', 'execute_spec']);
  });
});

describe('the policy of execute_spec', () => {
  it('takes a primitive, a name and an input, as expressions or literals', () => {
    expect(
      rejectedIn(`
  - summarize:
      call: execute_spec
      with: { primitive: inference, name: '\${ .spec }', input: { text: '\${ .text }' } }
`),
    ).toEqual([]);
  });

  it('rejects arguments it does not take and arguments it lacks', () => {
    expect(
      rejectedIn(`
  - nothing: { call: execute_spec }
  - partial: { call: execute_spec, with: { name: 3, model: big } }
`),
    ).toEqual([
      '/do/0/nothing/with: execute_spec takes with: { primitive, name, input }',
      '/do/1/partial/with/model: execute_spec takes no argument model',
      '/do/1/partial/with/primitive: execute_spec needs a string primitive',
      '/do/1/partial/with/name: execute_spec needs a string name',
    ]);
  });

  it('rejects executing another workflow, and broken expressions in its arguments', () => {
    expect(
      rejectedIn(`
  - nested: { call: execute_spec, with: { primitive: orchestration, name: other, input: ['\${ .a + }'] } }
`),
    ).toEqual([
      '/do/0/nested/with/primitive: A workflow cannot execute another workflow in this version',
      expect.stringMatching(/^\/do\/0\/nested\/with\/input\/0: /u),
    ]);
  });
});
