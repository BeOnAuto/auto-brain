import { Buffer } from 'node:buffer';

import { Conflict } from '@beonauto/operations';
import type { Executed } from '@beonauto/specs';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { answers, textResult } from '../testing/index.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';
import { documentOf } from '../testing/spec-documents.ts';

const oneMebibyte = 1_048_576;

const withInstructions = documentOf(
  'model: openai/gpt-5',
  '{% system %}{{ input.rules }}{% endsystem %}{{ input.text }}',
);

const withoutInstructions = documentOf('model: openai/gpt-5', '{{ input.text }}');

const measuring = {
  onSuccess: (executed: Executed) => Buffer.byteLength(JSON.stringify(executed), 'utf8'),
  onFailure: () => Number.POSITIVE_INFINITY,
};

describe('the record of an execution', () => {
  it('keeps the whole prompt when it fits with the answer', async () => {
    const { executing } = reasoningWith(answers(textResult('Short')));
    const text = 'é'.repeat(150_000);

    expect(await executing(withInstructions, { rules: 'Be brief.', text })).toMatchObject(
      Exit.succeed({
        output: 'Short',
        record: { prompt: { instructions: 'Be brief.', message: text, truncated: false } },
      }),
    );
  });

  it('cuts the prompt so that the answer and the record take at most 1 MiB', async () => {
    const { executing } = reasoningWith(answers(textResult('a'.repeat(700_000))));
    const execution = await executing(withInstructions, { rules: 'r'.repeat(199_000), text: 't'.repeat(199_000) });

    expect(execution).toMatchObject(
      Exit.succeed({ output: 'a'.repeat(700_000), record: { prompt: { truncated: true } } }),
    );
    expect(Exit.match(execution, measuring)).toBeLessThanOrEqual(oneMebibyte);
    expect(Exit.match(execution, measuring)).toBeGreaterThan(oneMebibyte - 4096);
  });

  it('gives the message all the room when there are no instructions', async () => {
    const { executing } = reasoningWith(answers(textResult('a'.repeat(900_000))));
    const execution = await executing(withoutInstructions, { text: 't'.repeat(199_000) });

    expect(execution).toMatchObject(Exit.succeed({ record: { prompt: { truncated: true } } }));
    expect(Exit.match(execution, measuring)).toBeLessThanOrEqual(oneMebibyte);
    expect(Exit.match(execution, measuring)).toBeGreaterThan(oneMebibyte - 4096);
  });

  it('cannot hold an answer that leaves no room for the prompt: the spec must ask for less', async () => {
    const { executing } = reasoningWith(answers(textResult('a'.repeat(oneMebibyte))));

    expect(await executing(withoutInstructions, { text: 'Go' })).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'The answer takes more than a run can record (1048576 bytes with its record); lower config.max_output_tokens in the reasoning function definition',
        }),
      ),
    );
  });
});
