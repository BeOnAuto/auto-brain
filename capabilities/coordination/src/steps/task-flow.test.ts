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

const jumps: Example = {
  tasks: [
    "  - start: { set: { n: 1 }, if: '${ $data.go }' }",
    '  - loop:',
    '      do:',
    '        - check: { set: { n: 2 }, then: exit }',
    '        - never: { set: { n: 3 } }',
    '  - again: { set: { n: 4 }, then: start }',
  ],
  diagram: [
    '  subgraph g1["2. In order"]',
    '    n3["3. Set n"]',
    '    n4["4. Set n"]',
    '  end',
    '  n1(["By a call"])',
    '  n2["1. Set n"]',
    '  n5["5. Set n"]',
    '  n1 -->|"if $data.go"| n2',
    '  n1 -->|"otherwise"| n3',
    '  n2 --> n3',
    '  n3 --> n5',
    '  n4 --> n5',
    '  n5 -->|"if $data.go"| n2',
    '  n5 -->|"otherwise"| n3',
  ],
  steps: [
    '1. **start** sets **n**, only when `$data.go` holds.',
    '2. **loop** does steps 3 to 4 in order.',
    '3. **check** sets **n**, and then leaves step 2.',
    '4. **never** sets **n**.',
    '5. **again** sets **n**, and then goes to step 1.',
  ],
};

const endings: Example = {
  tasks: [
    '  - route:',
    '      switch:',
    "        - stop: { when: '${ $data.stop }', then: end }",
    "        - leave: { when: '${ $data.leave }', then: exit }",
    "        - onward: { when: '${ $data.onward }', then: continue }",
    '      then: last',
    '  - skipped: { set: { skipped: true }, then: end }',
    '  - last: { set: { last: true }, then: exit }',
  ],
  diagram: [
    '  n1(["By a call"])',
    '  n2{"1. Choose a case"}',
    '  n3["2. Set skipped"]',
    '  n4["3. Set last"]',
    '  n1 --> n2',
    '  n2 -->|"onward"| n3',
    '  n2 -->|"no case holds"| n4',
  ],
  steps: [
    '1. **route** chooses the first case that holds: **stop**, when `$data.stop`, ends the run, **leave**, when `$data.leave`, ends the run, **onward**, when `$data.onward`, goes on, and when no case holds, it goes to step 3.',
    '2. **skipped** sets **skipped**, and then ends the run.',
    '3. **last** sets **last**, and then ends the run.',
  ],
};

const conditions: Example = {
  tasks: [
    '  - steps:',
    '      do:',
    '        - route:',
    '            switch:',
    "              - out: { when: '${ $data.out }', then: exit }",
    '              - other: {}',
    "        - guarded: { set: { g: 1 }, if: '${ $data.g }' }",
    '  - after: { set: { a: 1 } }',
    '  - named: { wait: PT1M, timeout: quick }',
    "  - computed: { wait: '${ $data.wait }', timeout: { after: '${ $data.most }' } }",
    '  - held: { wait: PT1S, timeout: {} }',
  ],
  diagram: [
    '  subgraph g1["1. In order"]',
    '    n2{"2. Choose a case"}',
    '    n3["3. Set g"]',
    '  end',
    '  n1(["By a call"])',
    '  n4["4. Set a"]',
    '  n5["5. Wait 1 minute"]',
    '  n6["6. Wait"]',
    '  n7["7. Wait 1 second"]',
    '  n1 --> n2',
    '  n2 -->|"out"| n4',
    '  n2 -->|"other, if $data.g"| n3',
    '  n2 -->|"other, otherwise"| n4',
    '  n3 --> n4',
    '  n4 --> n5',
    '  n5 --> n6',
    '  n6 --> n7',
  ],
  steps: [
    '1. **steps** does steps 2 to 3 in order.',
    '2. **route** chooses the first case that holds: **out**, when `$data.out`, leaves step 1 and **other**, by default, goes on.',
    '3. **guarded** sets **g**, only when `$data.g` holds.',
    '4. **after** sets **a**.',
    '5. **named** waits 1 minute, within the timeout **quick**.',
    '6. **computed** waits for a time computed when it runs, within a time computed when it runs.',
    '7. **held** waits 1 second, within a time computed when it runs.',
  ],
};

describe('the flow between the steps of a diagram', () => {
  it('follows then to a named step, out of a list with exit, and around a step whose if does not hold', () => {
    const done = drawnFrom(jumps);

    expect(done).toEqual(expectedOf(jumps));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });

  it('ends the run at end and at an exit of the workflow, and follows a switch of its own when no case holds', () => {
    const done = drawnFrom(endings);

    expect(done).toEqual(expectedOf(endings));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });

  it('labels a case that reaches a step whose if may not hold, and says the timeout of a step', () => {
    const done = drawnFrom(conditions);

    expect(done).toEqual(expectedOf(conditions));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});
