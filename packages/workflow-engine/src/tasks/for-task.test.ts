import { describe, expect, it } from 'vitest';

import { drivenRun, stepsIn, stepsWith } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

describe('a for task', () => {
  it('runs its body for each item, with the item and its index under the names it gives', () => {
    const document = workflow(`
do:
  - each:
      for: { in: '\${ .items }', each: name, at: position }
      do:
        - add: { set: '\${ { seen: ((.seen // []) + [$name + ($position | tostring)]) } }' }
`);

    expect(drivenRun(document, { input: { items: ['a', 'b'] } }).outcome).toEqual({
      kind: 'completed',
      output: { seen: ['a0', 'b1'] },
    });
  });

  it('names the item item and the index index when it gives no names', () => {
    const document = workflow(`
do:
  - each:
      for: { in: '\${ [5, 6] }' }
      do:
        - add: { set: '\${ { last: [$item, $index] } }' }
`);

    expect(drivenRun(document).outcome).toEqual({ kind: 'completed', output: { last: [6, 1] } });
  });

  it('stops once its condition no longer holds', () => {
    const document = workflow(`
do:
  - each:
      for: { in: '\${ [1, 2, 3, 4] }' }
      while: '\${ (.total // 0) < 3 }'
      do:
        - add: { set: '\${ { total: ((.total // 0) + $item) } }' }
`);

    expect(drivenRun(document).outcome).toEqual({ kind: 'completed', output: { total: 3 } });
  });
});

describe('a for task given what it cannot loop over', () => {
  it('gives its input for an empty list', () => {
    const document = workflow("do:\n  - each: { for: { in: '${ [] }' }, do: [{ add: { set: { x: 1 } } }] }");

    expect(drivenRun(document, { input: { kept: true } }).outcome).toEqual({
      kind: 'completed',
      output: { kept: true },
    });
  });

  it('raises a validation error when it is not given a list', () => {
    const document = workflow("do:\n  - each: { for: { in: '${ 1 }' }, do: [{ add: { set: { x: 1 } } }] }");

    expect(drivenRun(document).outcome).toMatchObject({
      kind: 'raised',
      error: { status: 400, title: 'for.in must give an array to iterate over', instance: '/do/0/each' },
    });
  });
});

describe('a for task that waits or stops', () => {
  it('waits inside its body and goes on with the next item', () => {
    const document = workflow(`
do:
  - each:
      for: { in: '\${ [1, 2] }' }
      do:
        - pause: { wait: PT1S }
        - add: { set: '\${ { total: ((.total // 0) + $item) } }' }
`);

    const run = drivenRun(document);

    expect(run.outcome).toEqual({ kind: 'completed', output: { total: 3 } });
    expect(stepsWith(run.events, 'waiting').filter(({ reference }) => reference.endsWith('pause'))).toHaveLength(2);
  });

  it('stops the workflow when its body ends it', () => {
    const document = workflow(`
do:
  - each:
      for: { in: '\${ [1, 2] }' }
      do:
        - stop: { set: { stopped: '\${ $item }' }, then: end }
  - after: { set: { reached: true } }
`);

    expect(drivenRun(document).outcome).toEqual({ kind: 'completed', output: { stopped: 1 } });
  });

  it('cancels its body when its timeout fires', () => {
    const document = workflow(`
do:
  - each:
      timeout: { after: PT1S }
      for: { in: '\${ [1, 2] }' }
      do:
        - pause: { wait: PT1H }
`);
    const run = drivenRun(document);

    expect(run.outcome).toMatchObject({ kind: 'raised', error: { status: 408, instance: '/do/0/each' } });
    expect(stepsIn(run.events)).toContainEqual({ reference: '/do/0/each/do/0/pause', run: 1, outcome: 'cancelled' });
  });
});
