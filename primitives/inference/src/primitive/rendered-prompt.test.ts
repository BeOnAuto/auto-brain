import { InvalidInput } from '@beonauto/operations';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { inferenceWith } from '../testing/inference-runs.ts';
import { documentOf } from '../testing/spec-documents.ts';

const model = 'model: openai/gpt-5';

function refused(detail: string, issue: string, pointer = '') {
  return Exit.fail(new InvalidInput({ detail, issues: [{ pointer, detail: issue }] }));
}

describe('a prompt that cannot be rendered from the input', () => {
  it('names the field the template reads and the input does not have', async () => {
    const { executing, requests } = inferenceWith();

    expect(await executing(documentOf(model, 'Dear {{ input.customer["first/name"] }},'), { customer: {} })).toEqual(
      refused(
        'The template reads a field the input does not have',
        'Line 4: the template reads input.customer.first/name, which this input does not have',
        '/customer/first~1name',
      ),
    );
    expect(requests()).toEqual([]);
  });

  it('points at the input as a whole when the missing name is not a field of it', async () => {
    const { executing } = inferenceWith();

    expect(
      await executing(documentOf(model, '{% for item in input.items %}{{ item.name }}{% endfor %}'), { items: [{}] }),
    ).toEqual(
      refused(
        'The template reads a field the input does not have',
        'Line 4: the template reads item.name, which this input does not have',
      ),
    );
  });
});

describe('a prompt the input makes unusable', () => {
  it('is refused when a filter refuses a value of the input', async () => {
    const { executing } = inferenceWith();

    expect(await executing(documentOf(model, 'Revenue: {{ input.revenue | money }}'), { revenue: 'lots' })).toEqual(
      refused(
        'The template cannot be rendered with this input',
        'Line 4: money takes a number, or text that is a decimal number',
      ),
    );
  });

  it('is refused when it would be longer than a prompt may be', async () => {
    const { executing } = inferenceWith();

    expect(
      await executing(documentOf(model, '{% for i in (1..3) %}{{ input.text }}{% endfor %}'), {
        text: 'x'.repeat(70_000),
      }),
    ).toEqual(
      refused(
        'With this input the message of the prompt would be longer than the template may render',
        'Line 4: the message grows past 200000 characters here',
      ),
    );
  });

  it('is refused when the render takes more than it may', async () => {
    const { executing } = inferenceWith();

    expect(
      await executing(documentOf(model, 'Count {% for i in (1..input.count) %}{% endfor %}'), { count: 6_000_000 }),
    ).toEqual(
      refused(
        'Rendering the template with this input takes more memory than a render may',
        'Line 4: the render stopped here',
      ),
    );
  });
});

describe('a prompt without a message', () => {
  it('is refused when the message it renders is empty', async () => {
    const { executing } = inferenceWith();

    expect(await executing(documentOf(model, '{{ input.text }}'), { text: '  ' })).toEqual(
      refused(
        'With this input the template renders an empty message',
        'The message the template renders from this input is empty',
      ),
    );
  });
});
