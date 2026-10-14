import { describe, expect, it } from 'vitest';

import { doneIn, stepNumbersOf, type DoneSteps } from '../testing/done-steps.ts';

interface Example extends DoneSteps {
  readonly tasks: readonly string[];
  readonly entries?: readonly string[];
}

function drawnFrom({ tasks, entries }: Example): DoneSteps {
  return doneIn(tasks.join('\n'), entries);
}

function expectedOf({ diagram, steps }: Example): DoneSteps {
  return { diagram, steps };
}

const called: Example = {
  tasks: [
    '  - review:',
    '      call: run_definition',
    "      with: { type: reasoning, name: review-brief, input: { brief: '${ $data.brief }' } }",
  ],
  entries: ['On com.example.brief.submitted', 'By a call'],
  diagram: [
    '  n1(["On com.example.brief.submitted"])',
    '  n2(["By a call"])',
    '  n3["1. Run review-brief"]',
    '  n1 --> n3',
    '  n2 --> n3',
  ],
  steps: ['1. **review** runs the reasoning function **review-brief**.'],
};

const assigned: Example = {
  tasks: ["  - tally: { set: { count: 1, total: '${ $data.total }' } }"],
  diagram: ['  n1(["By a call"])', '  n2["1. Set count and total"]', '  n1 --> n2'],
  steps: ['1. **tally** sets **count** and **total**.'],
};

const raised: Example = {
  tasks: [
    '  - stop:',
    '      raise:',
    '        error: { type: https://example.com/errors/stopped, status: 409, title: Stopped }',
    '  - unreached: { set: { reached: true } }',
  ],
  diagram: ['  n1(["By a call"])', '  n2(["1. Raise “Stopped”"])', '  n3["2. Set reached"]', '  n1 --> n2'],
  steps: ['1. **stop** raises the error *Stopped*, with status 409.', '2. **unreached** sets **reached**.'],
};

const waited: Example = {
  tasks: [
    '  - hear:',
    '      listen:',
    '        to:',
    '          any:',
    '            - with: { type: com.example.a }',
    `            - with: { type: '\${ "com.example." + $data.kind }' }`,
    '      timeout: { after: PT1H }',
    '  - pause: { wait: { hours: 2, minutes: 30 } }',
    '  - announce:',
    '      emit:',
    '        event:',
    '          with: { type: com.example.brief.approved, source: https://example.com/campaigns }',
  ],
  diagram: [
    '  n1(["By a call"])',
    '  n2["1. Wait for com.example.a or an event sent to the run"]',
    '  n3["2. Wait 2 hours and 30 minutes"]',
    '  n4["3. Publish com.example.brief.approved"]',
    '  n1 --> n2',
    '  n2 --> n3',
    '  n3 --> n4',
  ],
  steps: [
    '1. **hear** waits for the first of the event **com.example.a** or an event sent to the run, for at most 1 hour.',
    '2. **pause** waits 2 hours and 30 minutes.',
    '3. **announce** publishes the event **com.example.brief.approved** to the playbook.',
  ],
};

const heard: Example = {
  tasks: [
    '  - one: { listen: { to: { one: { with: { type: com.example.a } } } } }',
    '  - all: { listen: { to: { all: [{ with: { type: com.example.a } }, { with: { type: com.example.b } }] } } }',
  ],
  diagram: [
    '  n1(["By a call"])',
    '  n2["1. Wait for com.example.a"]',
    '  n3["2. Wait for com.example.a and com.example.b"]',
    '  n1 --> n2',
    '  n2 --> n3',
  ],
  steps: [
    '1. **one** waits for the event **com.example.a**.',
    '2. **all** waits for each of the event **com.example.a** and the event **com.example.b**.',
  ],
};

const ordered: Example = {
  tasks: [
    '  - steps:',
    '      do:',
    '        - first: { set: { a: 1 } }',
    '        - second: { set: { b: 2 } }',
    "  - build: { run: { script: { language: js, code: '1' } } }",
  ],
  diagram: [
    '  subgraph g1["1. In order"]',
    '    n2["2. Set a"]',
    '    n3["3. Set b"]',
    '  end',
    '  n1(["By a call"])',
    '  n4["4. Run a script"]',
    '  n1 --> n2',
    '  n2 --> n3',
    '  n3 --> n4',
  ],
  steps: [
    '1. **steps** does steps 2 to 3 in order.',
    '2. **first** sets **a**.',
    '3. **second** sets **b**.',
    '4. **build** runs a script.',
  ],
};

describe('the diagram of a call of run_definition', () => {
  it('is a node named for the definition it runs, entered from each way the workflow starts', () => {
    const done = drawnFrom(called);

    expect(done).toEqual(expectedOf(called));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});

describe('the diagram of a set', () => {
  it('is a node that names what it sets', () => {
    const done = drawnFrom(assigned);

    expect(done).toEqual(expectedOf(assigned));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});

describe('the diagram of a raise', () => {
  it('is an end node, with no step after it', () => {
    const done = drawnFrom(raised);

    expect(done).toEqual(expectedOf(raised));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});

describe('the diagram of a listen, a wait and an emit', () => {
  it('are nodes that wait for their events, wait their time and publish their event', () => {
    const done = drawnFrom(waited);

    expect(done).toEqual(expectedOf(waited));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });

  it('say which events a listen waits for, one or each of them', () => {
    const done = drawnFrom(heard);

    expect(done).toEqual(expectedOf(heard));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});

describe('the diagram of a do and of a run', () => {
  it('are a group of the tasks in order, and a node that runs its process', () => {
    const done = drawnFrom(ordered);

    expect(done).toEqual(expectedOf(ordered));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});
