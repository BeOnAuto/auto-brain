import { makeInference } from '@beonauto/inference';
import { scriptedLanguageModel } from '@beonauto/inference/testing';
import { describe, expect, it } from 'vitest';

import { longestCallOf } from './workflows.ts';

describe('the longest a nested execution of a workflow may run', () => {
  it('is as long as its primitive states, 1660 s for inference, and a minute more', () => {
    const inference = makeInference({
      languageModel: scriptedLanguageModel().languageModel,
      offered: { providers: [], aliases: [] },
    });

    expect(longestCallOf([inference])).toBe(1_720_000);
  });

  it('is the longest any primitive states, and a minute more', () => {
    expect(longestCallOf([{ longestExecutionMs: 5000 }, { longestExecutionMs: 90_000 }])).toBe(150_000);
  });
});
