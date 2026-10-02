import { describe, expect, it } from 'vitest';

import { alternatives, asSentence, capitalized, counted, listed, quoted } from '../index.ts';

const prompt = { one: 'prompt', other: 'prompts' };

const lists: ReadonlyArray<readonly [readonly string[], string]> = [
  [['a'], 'a'],
  [['a', 'b'], 'a and b'],
  [['a', 'b', 'c'], 'a, b, and c'],
];

describe('phrasing', () => {
  it('quotes a name with typographic quotes', () => {
    expect(quoted('Sales')).toBe('“Sales”');
  });

  it.each(lists)('lists %j as %s', (items, text) => {
    expect(listed(items)).toBe(text);
  });

  it('capitalizes the first letter of a sentence, and leaves one that starts with a quote', () => {
    expect([capitalized('the prompt'), capitalized('“summary” is'), capitalized('')]).toEqual([
      'The prompt',
      '“summary” is',
      '',
    ]);
  });

  it('lists alternatives with or', () => {
    expect(alternatives(['prompt', 'workflow'])).toBe('prompt or workflow');
  });

  it.each([
    [0, '0 prompts'],
    [1, '1 prompt'],
    [2, '2 prompts'],
  ])('counts %i as %s', (count, text) => {
    expect(counted(count, prompt)).toBe(text);
  });

  it.each([
    ['Summarizes a text', 'Summarizes a text.'],
    ['  Summarizes a text.  ', 'Summarizes a text.'],
    ['Is it done?', 'Is it done?'],
    ['Says “hi!”', 'Says “hi!”'],
  ])('makes %j a sentence', (text, sentence) => {
    expect(asSentence(text)).toBe(sentence);
  });
});
