import { describe, expect, it } from 'vitest';

import { interpret, workflow } from '../testing/workflows.ts';

describe('a for loop', () => {
  it('runs its tasks once for each item, passing the output of one round to the next', async () => {
    const document = workflow(`
do:
  - total:
      for:
        in: .items
        each: item
        at: position
      do:
        - add:
            set: { sum: '\${ .sum + $item }', last: '\${ $position }' }
`);

    expect((await interpret(document, { input: { items: [1, 2, 3], sum: 0 } })).ending).toEqual({
      kind: 'completed',
      output: { sum: 6, last: 2 },
    });
  });

  it('names its item and index item and index unless told otherwise', async () => {
    const document = workflow(`
do:
  - collect:
      for: { in: '\${ .letters }' }
      do:
        - note:
            set: { seen: '\${ .seen + [$item + ($index | tostring)] }' }
`);

    expect((await interpret(document, { input: { letters: ['a', 'b'], seen: [] } })).ending).toEqual({
      kind: 'completed',
      output: { seen: ['a0', 'b1'] },
    });
  });
});

describe('a for loop that stops', () => {
  it('stops when its while condition no longer holds', async () => {
    const document = workflow(`
do:
  - count:
      for: { in: .items }
      while: .count < 2
      do:
        - increment:
            set: { count: '\${ .count + 1 }' }
`);

    expect((await interpret(document, { input: { items: [1, 2, 3, 4], count: 0 } })).ending).toEqual({
      kind: 'completed',
      output: { count: 2 },
    });
  });
});

describe('a for loop that leaves', () => {
  it('stops at an exit, and ends the workflow at an end', async () => {
    const exiting = workflow(`
do:
  - loop:
      for: { in: .items }
      do:
        - stop:
            set: { stopped: '\${ $item }' }
            then: exit
  - after:
      set: { after: '\${ .stopped }' }
`);
    const ending = workflow(`
do:
  - loop:
      for: { in: .items }
      do:
        - stop:
            set: { stopped: '\${ $item }' }
            then: end
  - after:
      set: { after: never }
`);

    expect((await interpret(exiting, { input: { items: ['a', 'b'] } })).ending).toEqual({
      kind: 'completed',
      output: { after: 'a' },
    });
    expect((await interpret(ending, { input: { items: ['a', 'b'] } })).ending).toEqual({
      kind: 'completed',
      output: { stopped: 'a' },
    });
  });
});

describe('a for loop over no array', () => {
  it('raises a validation error when it is given no array', async () => {
    const document = workflow(`
do:
  - loop:
      for: { in: .missing }
      do: []
`);

    expect((await interpret(document)).settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'for.in must give an array to iterate over (at /do/0/loop)',
    });
  });

  it('raises a validation error when it says nothing to iterate over', async () => {
    expect((await interpret(workflow('do:\n  - loop: { for: {}, do: [] }'))).settlement).toMatchObject({
      detail: 'for.in must give an array to iterate over (at /do/0/loop)',
    });
  });
});
