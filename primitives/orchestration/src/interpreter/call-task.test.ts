import { describe, expect, it } from 'vitest';

import { acmeCaller, callsIn, interpret, workflow, onMachine } from '../testing/workflows.ts';
import type { SpecCallResult } from './host.ts';

const summarizing = workflow(`
do:
  - summarize:
      call: execute_spec
      with:
        primitive: inference
        name: summarize
        input:
          text: \${ .text }
`);

function answering(result: SpecCallResult) {
  return { respond: () => result };
}

describe('a call of execute_spec', () => {
  it('executes the spec with the evaluated input, for the caller of the workflow, and outputs its output', async () => {
    const { ending, commands } = await interpret(summarizing, {
      input: { text: 'long' },
      ...answering({ status: 'succeeded', output: { summary: 'short' } }),
    });

    expect(ending).toEqual({ kind: 'completed', output: { summary: 'short' } });
    expect(commands[1]).toEqual({
      kind: 'call',
      call: {
        org: 'acme',
        brain: 'alpha',
        caller: acmeCaller,
        reference: '/do/0/summarize',
        run: 1,
        primitive: 'inference',
        name: 'summarize',
        input: { text: 'long' },
      },
    });
  });
});

describe('the time a call may take', () => {
  it.skipIf(onMachine)('is the longest nested execution the run allows', async () => {
    const allowed: number[] = [];

    await interpret(summarizing, {
      input: { text: 'long' },
      longestNestedExecutionMs: 1_660_000,
      host: (fake) => ({
        ...fake.host,
        executeSpec: (call, longestMs) => {
          allowed.push(longestMs);
          return fake.host.executeSpec(call, longestMs);
        },
      }),
    });

    expect(allowed).toStrictEqual([1_660_000]);
  });
});

describe('the runs of a call', () => {
  it('are counted per task, so each run is its own execution', async () => {
    const document = workflow(`
do:
  - each:
      for: { in: .items }
      do:
        - summarize:
            call: execute_spec
            with: { primitive: inference, name: summarize, input: '\${ $item }' }
`);

    const { commands } = await interpret(document, { input: { items: ['a', 'b'] } });

    expect(callsIn(commands).map(({ reference, run }) => [reference, run])).toEqual([
      ['/do/0/each/do/0/summarize', 1],
      ['/do/0/each/do/0/summarize', 2],
    ]);
  });

  it('gives an execution an empty object when it is given no input', async () => {
    const document = workflow('do:\n  - plain: { call: execute_spec, with: { primitive: echo, name: greet } }');

    const { commands } = await interpret(document);

    expect(commands[1]).toMatchObject({ kind: 'call', call: { input: {} } });
  });
});

describe('the arguments of execute_spec', () => {
  it.each([
    ['nothing', 'do:\n  - x: { call: execute_spec }', 'execute_spec takes with: { primitive, name, input }'],
    [
      'no name',
      'do:\n  - x: { call: execute_spec, with: { primitive: echo, name: "${ 1 }" } }',
      'execute_spec needs a string primitive and a string name',
    ],
    [
      'no primitive',
      'do:\n  - x: { call: execute_spec, with: { primitive: "${ null }", name: a } }',
      'execute_spec needs a string primitive and a string name',
    ],
    [
      'a workflow',
      'do:\n  - x: { call: execute_spec, with: { primitive: "${ \\"orchestration\\" }", name: a } }',
      'A workflow cannot execute another workflow in this version',
    ],
  ])('are rejected when they evaluate to %s', async (_case, source, title) => {
    const { settlement, commands } = await interpret(workflow(source));

    expect(settlement).toMatchObject({ status: 'rejected', detail: `${title} (at /do/0/x)` });
    expect(callsIn(commands)).toEqual([]);
  });

  it('are rejected when the input is larger than an execution takes', async () => {
    const { settlement } = await interpret(summarizing, { input: { text: 'x'.repeat(262_200) } });

    expect(settlement).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail:
        'The input of execute_spec takes 262211 bytes as JSON, more than the 262144 an execution takes (at /do/0/summarize)',
    });
  });
});
