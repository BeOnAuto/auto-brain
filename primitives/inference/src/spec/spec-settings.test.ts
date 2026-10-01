import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/spec-documents.ts';

describe('the model of a spec', () => {
  it('is written provider/model', () => {
    expect(parsed(documentOf('model: bedrock/arn:aws:bedrock:eu-central-1:1:inference-profile/x')).model).toBe(
      'bedrock/arn:aws:bedrock:eu-central-1:1:inference-profile/x',
    );
    expect(issuesIn(documentOf('model: gpt-5'))).toEqual([
      'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5',
    ]);
    expect(issuesIn(documentOf('model: openai/'))).toHaveLength(1);
  });
});

describe('the settings of a spec', () => {
  it('default to 1024 output tokens', () => {
    expect(parsed(documentOf('model: openai/gpt-5\nconfig: {temperature: 0}')).settings).toEqual({
      max_output_tokens: 1024,
      temperature: 0,
    });
  });

  it('take at most 64000 output tokens, as a whole number of 1 or more', () => {
    expect(parsed(documentOf('model: openai/gpt-5\nconfig: {max_output_tokens: 64000}')).settings).toEqual({
      max_output_tokens: 64_000,
    });
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 64001'))).toEqual([
      'Line 4, /config/max_output_tokens: Expected at most 64000',
    ]);
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 0.5'))).toEqual([
      'Line 4, /config/max_output_tokens: Expected an integer of 1 or more',
    ]);
  });

  it('take a seed that is a whole number of 0 or more', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  seed: -1'))).toEqual([
      'Line 4, /config/seed: Expected an integer of 0 or more',
    ]);
  });
});
