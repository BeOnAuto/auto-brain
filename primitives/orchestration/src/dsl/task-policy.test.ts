import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';
import { refusalsOf } from './policy.ts';

function refusedIn(tasks: string): readonly string[] {
  return refusalsOf(workflow(`do:\n${tasks}`)).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

describe('the policy of the tasks of a document', () => {
  it('refuses run and emit tasks, and a task with no type', () => {
    expect(
      refusedIn(`
  - shell: { run: { shell: { command: ls } } }
  - announce: { emit: { event: { with: { type: done } } } }
  - dance: { tango: true }
`),
    ).toEqual([
      '/do/0/shell/run: run tasks (shell, script, container, workflow) are not allowed',
      '/do/1/announce/emit: emit is not supported in this version',
      '/do/2/dance: The task has no type this runtime knows',
    ]);
  });

  it.each(['http', 'grpc', 'openapi', 'asyncapi', 'a2a', 'mcp'])('refuses call: %s', (name) => {
    expect(refusedIn(`  - fetch: { call: ${name}, with: {} }`)).toEqual([
      `/do/0/fetch/call: call: ${name} is not allowed: a workflow reaches the world only through the specs of its brain; call execute_spec`,
    ]);
  });

  it('refuses a call of a function other than execute_spec', () => {
    expect(refusedIn('  - log: { call: log, with: {} }')).toEqual([
      '/do/0/log/call: call: log names no function; the one function is execute_spec',
    ]);
  });
});

describe('the policy of execute_spec', () => {
  it('takes a primitive, a name and an input, as expressions or literals', () => {
    expect(
      refusedIn(`
  - summarize:
      call: execute_spec
      with: { primitive: inference, name: '\${ .spec }', input: { text: '\${ .text }' } }
`),
    ).toEqual([]);
  });

  it('refuses arguments it does not take and arguments it lacks', () => {
    expect(
      refusedIn(`
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

  it('refuses executing another workflow, and broken expressions in its arguments', () => {
    expect(
      refusedIn(`
  - nested: { call: execute_spec, with: { primitive: orchestration, name: other, input: ['\${ .a + }'] } }
`),
    ).toEqual([
      '/do/0/nested/with/primitive: A workflow cannot execute another workflow in this version',
      expect.stringMatching(/^\/do\/0\/nested\/with\/input\/0: /u),
    ]);
  });
});

describe('the policy of listen', () => {
  it('takes one, all or any events by their attributes', () => {
    expect(
      refusedIn(`
  - one: { listen: { to: { one: { with: { type: approved } } } } }
  - all: { listen: { to: { all: [{ with: { type: a } }, { with: { type: b } }] }, read: envelope } }
  - any: { listen: { to: { any: [{ with: { data: '\${ .ok }' } }] } } }
`),
    ).toEqual([]);
  });

  it('refuses until, foreach, correlation and broken filters', () => {
    expect(
      refusedIn(`
  - until: { listen: { to: { any: [], until: .done } } }
  - each: { listen: { to: { one: { with: { type: a } } } }, foreach: { do: [] } }
  - correlated: { listen: { to: { all: [{ with: { type: a }, correlate: { id: { from: .id } } }, 3] } } }
  - broken: { listen: { to: { one: { with: { data: '\${ .a + }' } } } } }
`),
    ).toEqual([
      '/do/0/until/listen/to/until: listen until is not supported in this version',
      '/do/1/each/foreach: listen foreach is not supported in this version',
      '/do/2/correlated/listen/to/all/0/correlate: Correlating events is not supported in this version',
      expect.stringMatching(/^\/do\/3\/broken\/listen\/to\/one\/with\/data: /u),
    ]);
  });
});
