import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';
import { rejectionsOf } from './policy.ts';

function pointersRejectedIn(tasks: string): readonly string[] {
  return rejectionsOf(workflow(`do:\n${tasks}`)).map(({ pointer }) => pointer);
}

describe('the expressions and durations of tasks', () => {
  it('are checked in raise, wait and set', () => {
    expect(
      pointersRejectedIn(`
  - missing: { raise: { error: nowhere } }
  - broken: { raise: { error: { type: '\${ .a + }', status: 400 } } }
  - pause: { wait: soon }
  - computed: { wait: '\${ .a + }' }
  - fixed: { set: [1, { a: '\${ .a + }' }] }
`),
    ).toEqual([
      '/do/0/missing/raise/error',
      '/do/1/broken/raise/error/type',
      '/do/2/pause/wait',
      '/do/3/computed/wait',
      '/do/4/fixed/set/1/a',
    ]);
  });

  it('are checked in switch and for', () => {
    expect(
      pointersRejectedIn(`
  - route: { switch: [{ odd: { when: .a +, then: end } }, { plain: { then: end } }, 3] }
  - loop: { for: { in: .a + }, while: .b +, do: [] }
`),
    ).toEqual(['/do/0/route/switch/0/odd/when', '/do/1/loop/for/in', '/do/1/loop/while']);
  });
});

describe('the catch of a try', () => {
  it('is checked with its retry policy', () => {
    expect(
      pointersRejectedIn(`
  - guarded:
      try: []
      catch:
        when: .a +
        exceptWhen: .b +
        retry: { delay: soon, limit: { duration: P1M, attempt: { duration: never } }, exceptWhen: .c + }
  - reused: { try: [], catch: { retry: nowhere } }
  - shaped: { try: [], catch: { retry: 3 } }
`),
    ).toEqual([
      '/do/0/guarded/catch/when',
      '/do/0/guarded/catch/exceptWhen',
      '/do/0/guarded/catch/retry/exceptWhen',
      '/do/0/guarded/catch/retry/delay',
      '/do/0/guarded/catch/retry/limit/duration',
      '/do/0/guarded/catch/retry/limit/attempt/duration',
      '/do/1/reused/catch/retry',
    ]);
  });

  it('may reuse a retry policy', () => {
    expect(
      rejectionsOf(
        workflow(`
use:
  retries:
    patient: { delay: PT1S }
do:
  - guarded: { try: [], catch: { retry: patient } }
`),
      ),
    ).toEqual([]);
  });
});

describe('the parts every task has', () => {
  it('are checked: guard, data, schemas and timeout', () => {
    expect(
      pointersRejectedIn(`
  - shaped:
      if: .a +
      input: { from: .b +, schema: { document: {} } }
      output: { as: { c: '\${ .c + }' } }
      export: { as: .d +, schema: { document: {} } }
      timeout: { after: never }
      set: {}
  - limited: { set: {}, timeout: nowhere }
`),
    ).toEqual([
      '/do/0/shaped/if',
      '/do/0/shaped/input/schema',
      '/do/0/shaped/input/from',
      '/do/0/shaped/output/as/c',
      '/do/0/shaped/export/schema',
      '/do/0/shaped/export/as',
      '/do/0/shaped/timeout/after',
      '/do/1/limited/timeout',
    ]);
  });
});

describe('tasks whose parts are not what the DSL says', () => {
  it('are read without breaking', () => {
    expect(
      pointersRejectedIn(`
  - fork: { fork: 3 }
  - loop: { for: 3, do: [] }
  - guarded: { try: [], catch: 3 }
  - deaf: { listen: 3 }
  - unheard: { listen: { to: { all: 3 } } }
  - silent: { raise: 3 }
  - route: { switch: 3 }
  - cases: { switch: [{ odd: 3 }] }
`),
    ).toEqual([]);
  });

  it('reject a call of no name', () => {
    expect(pointersRejectedIn('  - nameless: { call: 3 }')).toEqual(['/do/0/nameless/call']);
  });
});

describe('the flow of tasks', () => {
  it('lets a task jump to a task of its own list only', () => {
    expect(
      pointersRejectedIn(`
  - first: { set: {}, then: third }
  - second: { set: {}, then: exit }
  - third: { set: {}, then: nowhere }
`),
    ).toEqual(['/do/2/third/then']);
  });

  it('checks the lists nested in do, for, try, catch and fork', () => {
    expect(
      pointersRejectedIn(`
  - block: { do: [{ inner: { run: {} } }] }
  - loop: { for: { in: .items }, do: [{ inner: { emit: {} } }] }
  - guarded: { try: [{ inner: { run: {} } }], catch: { do: [{ handler: { run: {} } }] } }
  - parallel:
      fork:
        branches:
          - left: { run: {} }
          - right: { set: {}, then: left }
          - done: { set: {}, then: end }
`),
    ).toEqual([
      '/do/0/block/do/0/inner/run',
      '/do/1/loop/do/0/inner/emit',
      '/do/2/guarded/try/0/inner/run',
      '/do/2/guarded/catch/do/0/handler/run',
      '/do/3/parallel/fork/branches/0/left/run',
      '/do/3/parallel/fork/branches/1/right/then',
    ]);
  });
});
