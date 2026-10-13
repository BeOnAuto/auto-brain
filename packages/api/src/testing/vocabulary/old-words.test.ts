import { describe, expect, it } from 'vitest';

import { foundIn, oldWordsIn } from './old-words.ts';

describe('the old words of the vocabulary', () => {
  it('are found in a text, each where it stands, and none in a text in the words of playbooks', () => {
    expect(oldWordsIn('A brain_key opened the execution of a spec.')).toEqual(['spec', 'execution', 'brain_key']);
    expect(foundIn('One spec, two specs.', 'specs?')).toEqual([
      { index: 4, word: 'spec' },
      { index: 14, word: 'specs' },
    ]);
    expect(oldWordsIn('A playbook runs its functions and workflows.')).toEqual([]);
  });
});
