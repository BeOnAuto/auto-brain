import { InvalidInput } from '@beonauto/operations';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { answers, textResult } from '../testing/index.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';

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

describe('the input of a run', () => {
  it('is a JSON object', async () => {
    const { running, requests } = reasoningWith();

    expect(await running(withSchema, ['text'])).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The input of a reasoning function definition is a JSON object',
          issues: [{ pointer: '', detail: 'Expected a JSON object' }],
        }),
      ),
    );
    expect(requests()).toEqual([]);
  });

  it('takes the defaults of the definition for the fields it leaves out', async () => {
    const { running, requests } = reasoningWith(answers(textResult('Done')));
    await running(withSchema, { text: 'the report' });

    expect(requests()[0]?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Summarize the report in 50 words.' }] },
    ]);
  });

  it('overrides the defaults with its own fields', async () => {
    const { running, requests } = reasoningWith(answers(textResult('Done')));
    await running(withSchema, { text: 'the report', words: 10 });

    expect(requests()[0]?.messages).toMatchObject([{ content: [{ text: 'Summarize the report in 10 words.' }] }]);
  });

  it('must match the input schema, with pointers to its fields', async () => {
    const { running, requests } = reasoningWith();

    expect(await running(withSchema, { words: 0, colour: 'red' })).toEqual(
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
