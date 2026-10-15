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

const recovered: Example = {
  tasks: [
    '  - attempt:',
    '      try:',
    '        - review: { call: run_definition, with: { type: reasoning, name: review-brief } }',
    '        - score: { call: run_definition, with: { type: computation, name: campaign-pace } }',
    '      catch:',
    '        errors: { with: { status: 503 } }',
    '        retry: { delay: { seconds: 5 }, limit: { attempt: { count: 3 } } }',
    '        do:',
    '          - fallback: { set: { review: null } }',
  ],
  diagram: [
    '  subgraph g1["1. Try"]',
    '    n2["2. Run review-brief"]',
    '    n3["3. Run campaign-pace"]',
    '  end',
    '  n1(["By a call"])',
    '  n4["4. Set review"]',
    '  n1 --> n2',
    '  n2 --> n3',
    '  n2 -.->|"on error 503, after retries"| n4',
    '  n3 -.->|"on error 503, after retries"| n4',
  ],
  steps: [
    '1. **attempt** tries steps 2 to 3; on an error with status 503, it tries again as its catch says, and once no retry is left, it does step 4.',
    '2. **review** runs the reasoning function **review-brief**.',
    '3. **score** runs the computation function **campaign-pace**.',
    '4. **fallback** sets **review**.',
  ],
};

const guarded: Example = {
  tasks: [
    '  - guarded:',
    '      try:',
    "        - risky: { call: run_definition, with: { type: reasoning, name: '${ $data.name }' } }",
    '      catch:',
    '        errors: { with: { type: https://on.auto/problems/unanswered, status: 410 } }',
    `        when: '\${ $error.kind == "expired" }'`,
    `        exceptWhen: '\${ $error.because == "notified" }'`,
    '        retry: patient',
    '  - after: { set: { done: true } }',
  ],
  diagram: [
    '  subgraph g1["1. Try"]',
    '    n2["2. Run a definition"]',
    '  end',
    '  n1(["By a call"])',
    '  n3["3. Set done"]',
    '  n1 --> n2',
    '  n2 --> n3',
    '  n2 -.->|"on error 410, after retries"| n3',
  ],
  steps: [
    '1. **guarded** tries step 2; on an error whose type is `https://on.auto/problems/unanswered` and with status 410, when `$error.kind == "expired"`, except when `$error.because == "notified"`, it tries again under the retry policy **patient**, and once no retry is left, it hands on its input.',
    '2. **risky** runs the definition its call names when it runs.',
    '3. **after** sets **done**.',
  ],
};

const nestedInALoop: Example = {
  tasks: [
    '  - each:',
    "      for: { in: '${ $data.briefs }' }",
    '      do:',
    '        - attempt:',
    '            try:',
    "              - review: { call: run_definition, with: { type: reasoning, name: review-brief, input: '${ $item }' } }",
    '            catch:',
    '              do:',
    '                - skip: { set: { skipped: true } }',
  ],
  diagram: [
    '  subgraph g1["1. For each item of $data.briefs"]',
    '    n3["4. Set skipped"]',
    '    subgraph g2["2. Try"]',
    '      n2["3. Run review-brief"]',
    '    end',
    '  end',
    '  n1(["By a call"])',
    '  n1 --> n2',
    '  n2 -->|"next item"| n2',
    '  n2 -.->|"on an error"| n3',
    '  n3 -->|"next item"| n2',
  ],
  steps: [
    '1. **each** does steps 2 to 4 for each **item** of `$data.briefs`.',
    '2. **attempt** tries step 3; on any error, it does step 4.',
    '3. **review** runs the reasoning function **review-brief**.',
    '4. **skip** sets **skipped**.',
  ],
};

const aroundAGroup: Example = {
  tasks: [
    '  - attempt:',
    '      try:',
    '        - both:',
    '            do:',
    '              - one: { set: { a: 1 } }',
    '              - two: { set: { b: 2 } }',
    '      catch:',
    '        do:',
    '          - recover: { set: { c: 3 } }',
  ],
  diagram: [
    '  subgraph g1["1. Try"]',
    '    subgraph g2["2. In order"]',
    '      n2["3. Set a"]',
    '      n3["4. Set b"]',
    '    end',
    '  end',
    '  n1(["By a call"])',
    '  n4["5. Set c"]',
    '  n1 --> n2',
    '  n2 --> n3',
    '  n2 -.->|"on an error"| n4',
    '  n3 -.->|"on an error"| n4',
  ],
  steps: [
    '1. **attempt** tries steps 2 to 4; on any error, it does step 5.',
    '2. **both** does steps 3 to 4 in order.',
    '3. **one** sets **a**.',
    '4. **two** sets **b**.',
    '5. **recover** sets **c**.',
  ],
};

describe('the diagram of a try', () => {
  it('is a group, with its catch a dashed edge from each of its steps to the steps that recover', () => {
    const done = drawnFrom(recovered);

    expect(done).toEqual(expectedOf(recovered));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });

  it('goes on with a dashed edge when its catch has no steps, and names the errors it catches', () => {
    const done = drawnFrom(guarded);

    expect(done).toEqual(expectedOf(guarded));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});

describe('the diagram of a task within another', () => {
  it('nests its group within the group of the task around it, and the catch of a try in that group too', () => {
    const done = drawnFrom(nestedInALoop);

    expect(done).toEqual(expectedOf(nestedInALoop));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });

  it('draws the catch of a try from each step of a group within it', () => {
    const done = drawnFrom(aroundAGroup);

    expect(done).toEqual(expectedOf(aroundAGroup));
    expect(stepNumbersOf(done).drawn).toEqual(stepNumbersOf(done).listed);
  });
});
