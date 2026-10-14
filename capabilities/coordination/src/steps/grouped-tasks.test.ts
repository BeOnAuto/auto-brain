import { describe, expect, it } from 'vitest';

import { doneIn, stepNumbersOf, type DoneSteps } from '../testing/done-steps.ts';

interface Example extends DoneSteps {
  readonly tasks: readonly string[];
}

function drawnFrom({ tasks }: Example): DoneSteps {
  return doneIn(tasks.join('\n'));
}

function expectedOf({ diagram, steps }: Example): DoneSteps {
  return { diagram, steps };
}

const choice: Example = {
  tasks: [
    '  - route:',
    '      switch:',
    "        - large: { when: '${ $data.n > 5 }', then: big }",
    '        - fallback: { then: small }',
    '  - big: { set: { size: large } }',
    '  - small: { set: { size: small } }',
  ],
  diagram: [
    '  n1(["By a call"])',
    '  n2{"1. Choose a case"}',
    '  n3["2. Set size"]',
    '  n4["3. Set size"]',
    '  n1 --> n2',
    '  n2 -->|"large"| n3',
    '  n2 -->|"fallback"| n4',
    '  n3 --> n4',
  ],
  steps: [
    '1. **route** chooses the first case that holds: **large**, when `$data.n > 5`, goes to step 2 and **fallback**, by default, goes to step 3.',
    '2. **big** sets **size**.',
    '3. **small** sets **size**.',
  ],
};

const loop: Example = {
  tasks: [
    '  - total:',
    "      for: { each: line, in: '${ $data.lines }' }",
    "      while: '${ ($data.sum ?? 0) < 1000 }'",
    '      do:',
    "        - add: { set: { sum: '${ ($data.sum ?? 0) + $line.amount }' } }",
    '  - report: { set: { reported: true } }',
  ],
  diagram: [
    '  subgraph g1["1. For each line of $data.lines"]',
    '    n2["2. Set sum"]',
    '  end',
    '  n1(["By a call"])',
    '  n3["3. Set reported"]',
    '  n1 --> n2',
    '  n2 --> n3',
    '  n2 -->|"next item"| n2',
  ],
  steps: [
    '1. **total** does step 2 for each **line** of `$data.lines`, while `($data.sum ?? 0) < 1000` holds.',
    '2. **add** sets **sum**.',
    '3. **report** sets **reported**.',
  ],
};

const branches: Example = {
  tasks: [
    '  - reviews:',
    '      fork:',
    '        branches:',
    '          - first: { call: run_definition, with: { type: reasoning, name: review-brief } }',
    '          - second: { call: run_definition, with: { type: computation, name: campaign-pace } }',
    '  - done: { set: { reviewed: true } }',
  ],
  diagram: [
    '  subgraph g1["1. At once"]',
    '    n2["2. Run review-brief"]',
    '    n3["3. Run campaign-pace"]',
    '  end',
    '  n1(["By a call"])',
    '  n4["4. Set reviewed"]',
    '  n1 --> n2',
    '  n1 --> n3',
    '  n2 --> n4',
    '  n3 --> n4',
  ],
  steps: [
    '1. **reviews** does steps 2 and 3 at once, and hands on a list of their outputs.',
    '2. **first** runs the reasoning function **review-brief**.',
    '3. **second** runs the computation function **campaign-pace**.',
    '4. **done** sets **reviewed**.',
  ],
};

const race: Example = {
  tasks: [
    '  - race:',
    '      fork:',
    '        compete: true',
    '        branches:',
    '          - quick: { wait: PT1M }',
    '          - slow: { wait: { hours: 2 } }',
  ],
  diagram: [
    '  subgraph g1["1. At once, the first to finish wins"]',
    '    n2["2. Wait 1 minute"]',
    '    n3["3. Wait 2 hours"]',
    '  end',
    '  n1(["By a call"])',
    '  n1 --> n2',
    '  n1 --> n3',
  ],
  steps: [
    '1. **race** does steps 2 and 3 at once, and hands on the output of the first to finish, cancelling the others.',
    '2. **quick** waits 1 minute.',
    '3. **slow** waits 2 hours.',
  ],
};

describe('the diagram of a switch', () => {
  it('is a decision with a branch for each case, to the step each case names', () => {
    const done = drawnFrom(choice);

    expect(done).toEqual(expectedOf(choice));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});

describe('the diagram of a for', () => {
  it('is a group around its tasks, the last of which goes back for the next item', () => {
    const done = drawnFrom(loop);

    expect(done).toEqual(expectedOf(loop));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});

describe('the diagram of a fork', () => {
  it('is a group with a branch for each of its branches, which join at the step after it', () => {
    const done = drawnFrom(branches);

    expect(done).toEqual(expectedOf(branches));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });

  it('notes in its group when the first branch to finish wins', () => {
    const done = drawnFrom(race);

    expect(done).toEqual(expectedOf(race));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});
