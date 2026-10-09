import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';
import { workflowFunctions, workflowPolicy } from './workflow-functions.ts';

function rejectedIn(tasks: string): readonly string[] {
  return workflowPolicy(workflow(`do:\n${tasks}`)).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

describe('the functions a workflow calls', () => {
  it('are run_definition alone: a workflow reaches the world through the definitions of its brain', () => {
    expect(
      rejectedIn(`
  - fetch: { call: http, with: {} }
  - log: { call: log, with: {} }
`),
    ).toEqual([
      '/do/0/fetch/call: call: http is not allowed: a workflow reaches the world only through its brain functions; call run_definition',
      '/do/1/log/call: call: log names no function; the one function is run_definition',
    ]);
  });

  it('are named when a document brings catalogs or functions', () => {
    expect(
      workflowPolicy(workflow('use: { catalogs: {}, functions: {} }\ndo: []')).map(({ detail }) => detail),
    ).toEqual([
      'catalogs are not supported in this version: a workflow calls only run_definition',
      'reusable functions are not supported in this version: call run_definition directly',
    ]);
  });
});

describe('a call of run_definition', () => {
  it('is described by the definition it runs, or by its name when that cannot be read', () => {
    expect([
      workflowFunctions.describe('run_definition', { type: 'reasoning', name: 'summarize' }),
      workflowFunctions.describe('run_definition', { type: 'echo', name: 'greet' }),
      workflowFunctions.describe('run_definition', { name: 'summarize' }),
      workflowFunctions.describe('run_definition', 'summarize'),
    ]).toEqual(['the reasoning function summarize', 'the echo definition greet', 'run_definition', 'run_definition']);
  });
});

describe('the policy of run_definition', () => {
  it('takes a type, a name and an input, as expressions or literals', () => {
    expect(
      rejectedIn(`
  - summarize:
      call: run_definition
      with: { type: reasoning, name: '\${ $data.definition }', input: { text: '\${ $data.text }' } }
`),
    ).toEqual([]);
  });

  it('rejects arguments it does not take and arguments it lacks', () => {
    expect(
      rejectedIn(`
  - nothing: { call: run_definition }
  - partial: { call: run_definition, with: { name: 3, model: big } }
`),
    ).toEqual([
      '/do/0/nothing/with: run_definition takes with: { type, name, input }',
      '/do/1/partial/with/model: run_definition takes no argument model',
      '/do/1/partial/with/type: run_definition needs a string type',
      '/do/1/partial/with/name: run_definition needs a string name',
    ]);
  });

  it('takes a call of another workflow, with expressions in its arguments', () => {
    expect(
      rejectedIn(`
  - nested: { call: run_definition, with: { type: workflow, name: other, input: ['\${ $data.a }'] } }
`),
    ).toEqual([]);
  });
});
