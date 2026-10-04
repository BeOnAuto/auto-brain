import { describe, expect, it } from 'vitest';

import { testFunctions, workflow } from '../testing/workflows.ts';
import { policyOf } from './policy.ts';

const rejectionsOf = policyOf(testFunctions);

function rejectedIn(tasks: string): readonly string[] {
  return rejectionsOf(workflow(`do:\n${tasks}`)).map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

describe('the policy of the tasks of a document', () => {
  it('rejects run and emit tasks, and a task with no type', () => {
    expect(
      rejectedIn(`
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

  it.each(['http', 'grpc', 'openapi', 'asyncapi', 'a2a', 'mcp'])('rejects call: %s', (name) => {
    expect(rejectedIn(`  - fetch: { call: ${name}, with: {} }`)).toEqual([
      `/do/0/fetch/call: call: ${name} is not allowed: a workflow reaches the world only through the functions it is given; call notify`,
    ]);
  });

  it('rejects a call of a function other than those its caller gives', () => {
    const twoFunctions = policyOf({ ...testFunctions, argumentChecks: { notify: () => [], page: () => [] } });

    expect(rejectedIn('  - log: { call: log, with: {} }')).toEqual([
      '/do/0/log/call: call: log names no function; the one function is notify',
    ]);
    expect(twoFunctions(workflow('do:\n  - log: { call: log }')).map(({ detail }) => detail)).toEqual([
      'call: log names no function; the functions are notify, page',
    ]);
  });

  it('leaves the arguments of a call to the checks of its function', () => {
    expect(
      rejectedIn(`
  - fine: { call: notify, with: { to: '\${ .who }' } }
  - bare: { call: notify }
  - broken: { call: notify, with: { to: '\${ .a + }' } }
`),
    ).toEqual(['/do/1/bare/with: notify takes with: { to }', expect.stringMatching(/^\/do\/2\/broken\/with\/to: /u)]);
  });
});

describe('the policy of listen', () => {
  it('takes one, all or any events by their attributes', () => {
    expect(
      rejectedIn(`
  - one: { listen: { to: { one: { with: { type: approved } } } } }
  - all: { listen: { to: { all: [{ with: { type: a } }, { with: { type: b } }] }, read: envelope } }
  - any: { listen: { to: { any: [{ with: { data: '\${ .ok }' } }] } } }
`),
    ).toEqual([]);
  });

  it('rejects until, foreach, correlation and broken filters', () => {
    expect(
      rejectedIn(`
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
