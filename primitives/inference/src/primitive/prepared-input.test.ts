import { InvalidInput } from '@beonauto/operations';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { answers, textResult } from '../testing/index.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';
import { documentOf } from '../testing/spec-documents.ts';

const withSchema = documentOf(
  [
    'model: openai/gpt-5',
    'input:',
    '  schema:',
    '    type: object',
    '    properties: {text: {type: string}, words: {type: integer, minimum: 1}}',
    '    required: [text, words]',
    '    additionalProperties: false',
    '  default: {words: 50}',
  ].join('\n'),
  'Summarize {{ input.text }} in {{ input.words }} words.',
);

describe('the input of an execution', () => {
  it('is a JSON object', async () => {
    const { executing, requests } = reasoningWith();

    expect(await executing(withSchema, ['text'])).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The input of a reasoning function definition is a JSON object',
          issues: [{ pointer: '', detail: 'Expected a JSON object' }],
        }),
      ),
    );
    expect(requests()).toEqual([]);
  });

  it('takes the defaults of the spec for the fields it leaves out', async () => {
    const { executing, requests } = reasoningWith(answers(textResult('Done')));
    await executing(withSchema, { text: 'the report' });

    expect(requests()[0]?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Summarize the report in 50 words.' }] },
    ]);
  });

  it('overrides the defaults with its own fields', async () => {
    const { executing, requests } = reasoningWith(answers(textResult('Done')));
    await executing(withSchema, { text: 'the report', words: 10 });

    expect(requests()[0]?.messages).toMatchObject([{ content: [{ text: 'Summarize the report in 10 words.' }] }]);
  });

  it('must match the input schema, with pointers to its fields', async () => {
    const { executing, requests } = reasoningWith();

    expect(await executing(withSchema, { words: 0, colour: 'red' })).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The input does not match the reasoning function’s input schema',
          issues: [
            { pointer: '/colour', detail: 'Expected no excess property' },
            { pointer: '/text', detail: 'Missing key' },
            { pointer: '/words', detail: 'Expected a value greater than or equal to 1' },
          ],
        }),
      ),
    );
    expect(requests()).toEqual([]);
  });
});
