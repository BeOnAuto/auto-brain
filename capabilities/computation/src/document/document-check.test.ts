import { InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace } from '../testing/campaign-pace.ts';
import {
  computationWith,
  functionOf,
  poolOf,
  programDocument,
  workerTestTimeoutMs,
} from '../testing/computation-runs.ts';

const frontMatter = [
  'language: typescript',
  'input:',
  '  schema: { type: object, required: [period], properties: { period: { type: integer } } }',
  'output:',
  '  schema: { type: object, required: [total], properties: { total: { type: number } } }',
].join('\n');

const keeping = 'let kept = 0;\nexport default function (input: Input): Output {\n  return { total: kept };\n}';

function checking(source: string) {
  const { prepared } = computationWith();
  return Effect.runPromiseExit(prepared(source).check);
}

describe('the check of a computation function when it is saved', { timeout: workerTestTimeoutMs }, () => {
  it('accepts the example of the reference, and a program over any JSON when the document has no schemas', async () => {
    expect(await checking(campaignPace)).toEqual(Exit.void);
    expect(await checking(programDocument(functionOf('return input;')))).toEqual(Exit.void);
  });

  it('refuses its program’s problems at their lines in the document, with the compiler’s words', async () => {
    const program = [
      'export default function (input: Input): Output {',
      '  const days = input.perod;',
      '  return { total: days, extra: true };',
      '}',
    ].join('\n');

    expect(await checking(programDocument(program, frontMatter))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The computation function definition has 2 problems',
          issues: [
            { pointer: '', detail: "Line 9: Property 'perod' does not exist on type 'Input'. Did you mean 'period'?" },
            {
              pointer: '',
              detail:
                "Line 10: Object literal may only specify known properties, and 'extra' does not exist in type 'Output'.",
            },
          ],
        }),
      ),
    );
  });

  it('refuses a module that keeps state, in the words of one problem', async () => {
    expect(await checking(programDocument(keeping, frontMatter))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The computation function definition has a problem',
          issues: [
            {
              pointer: '',
              detail:
                'Line 8: A module holds its types and its exported functions and nothing else, so that two calls share nothing',
            },
          ],
        }),
      ),
    );
  });
});

describe('a check of a computation function that does not answer', { timeout: workerTestTimeoutMs }, () => {
  it('is unavailable when its check does not answer', async () => {
    const pool = poolOf();
    const busy = {
      ...pool,
      check: () => Promise.resolve({ ran: 'stopped', because: 'deadline', milliseconds: 2000 } as const),
    };
    const { prepared } = computationWith(busy);

    expect(await Effect.runPromiseExit(prepared(campaignPace).check)).toEqual(
      Exit.fail(
        new Unavailable({
          detail:
            'The check of the document did not answer within the 2000 ms a save allows it, and was stopped; try again',
        }),
      ),
    );
  });
});
