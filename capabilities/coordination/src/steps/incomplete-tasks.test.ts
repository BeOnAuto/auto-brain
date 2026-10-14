import { describe, expect, it } from 'vitest';

import { doneIn, stepNumbersOf } from '../testing/done-steps.ts';

const tasks = [
  '  - odd: { mystery: 1 }',
  '  - loop: { for: {} }',
  '  - empty: { fork: { branches: [] } }',
  '  - bare: { fork: [] }',
  '  - deaf: { listen: {} }',
  '  - silent: { raise: {} }',
  '  - unnamed: { raise: { error: unavailable } }',
  '  - untitled: { raise: { error: { type: https://example.com/errors/x } } }',
  '  - quiet: { raise: { error: { status: 500 } } }',
  '  - blank: { emit: { event: { with: {} } } }',
  "  - computed: { set: '${ $data }' }",
  '  - nothing: { set: [] }',
  '  - fetch: { call: http, with: {} }',
  '  - process: { run: {} }',
  '  - unguarded: { try: [] }',
  '  - none: { do: [] }',
  '  - single: { fork: { branches: [{ only: { set: { o: 1 } } }] } }',
  '  - bad: { switch: {} }',
  '  - mixed: { switch: [1, { fallback: null }] }',
  "  - maybe: { switch: [{ perhaps: { when: '${ $data.maybe }' } }] }",
  '  - idle: { do: [], then: idle }',
];

const groups = [
  '  subgraph g1["2. For each item of null"]',
  '  end',
  '  subgraph g2["3. At once"]',
  '  end',
  '  subgraph g3["4. At once"]',
  '  end',
  '  subgraph g4["15. Try"]',
  '  end',
  '  subgraph g5["16. In order"]',
  '  end',
  '  subgraph g6["17. At once"]',
  '    n13["18. Set o"]',
  '  end',
  '  subgraph g7["22. In order"]',
  '  end',
];

const nodes = [
  '  n1(["By a call"])',
  '  n2["1. odd"]',
  '  n3["5. Wait for an event sent to the run"]',
  '  n4(["6. Raise an error"])',
  '  n5(["7. Raise unavailable"])',
  '  n6(["8. Raise an error"])',
  '  n7(["9. Raise an error"])',
  '  n8["10. Publish an event"]',
  '  n9["11. Set its data"]',
  '  n10["12. Set its data"]',
  '  n11["13. Call http"]',
  '  n12["14. Run a process"]',
  '  n14{"19. Choose a case"}',
  '  n15{"20. Choose a case"}',
  '  n16{"21. Choose a case"}',
];

const edges = [
  '  n1 --> n2',
  '  n2 --> n3',
  '  n3 --> n4',
  '  n8 --> n9',
  '  n9 --> n10',
  '  n10 --> n11',
  '  n11 --> n12',
  '  n12 --> n13',
  '  n13 --> n14',
  '  n14 -->|"no case holds"| n15',
  '  n15 -->|"fallback"| n16',
];

const steps = [
  '1. **odd** is a step this runtime does not run.',
  '2. **loop** does nothing for each **item** of `null`.',
  '3. **empty** does nothing at once.',
  '4. **bare** does nothing at once.',
  '5. **deaf** waits for an event sent to the run.',
  '6. **silent** raises an error.',
  '7. **unnamed** raises the error **unavailable** its document names under `use.errors`.',
  '8. **untitled** raises an error of the type `https://example.com/errors/x`.',
  '9. **quiet** raises an error.',
  '10. **blank** publishes an event of a type computed when it runs to the playbook.',
  '11. **computed** sets its data from `$data`.',
  '12. **nothing** sets its data.',
  '13. **fetch** calls `http`.',
  '14. **process** runs a process.',
  '15. **unguarded** tries nothing; on any error, it hands on its input.',
  '16. **none** does nothing in order.',
  '17. **single** does step 18 at once, and hands on a list of their outputs.',
  '18. **only** sets **o**.',
  '19. **bad** chooses the first case that holds: when no case holds, it goes on.',
  '20. **mixed** chooses the first case that holds: **fallback**, by default, goes on.',
  '21. **maybe** chooses the first case that holds: **perhaps**, when `$data.maybe`, goes on and when no case holds, it goes on.',
  '22. **idle** does nothing in order, and then goes to step 22.',
];

describe('the diagram of steps its document leaves incomplete', () => {
  it('still draws each step, says what it can of it, and draws no edge around a step that comes back to itself', () => {
    const done = doneIn(tasks.join('\n'));
    const { drawn, listed } = stepNumbersOf(done);

    expect(done).toEqual({ diagram: [...groups, ...nodes, ...edges], steps });
    expect(drawn).toEqual(listed);
  });

  it('has no steps when its list holds none', () => {
    expect(doneIn('  []')).toEqual({ diagram: ['  n1(["By a call"])'], steps: [''] });
  });
});
