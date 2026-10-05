import { describe, expect, it } from 'vitest';

import { alternatives, asSentence, capitalized, counted, listed, plainNumber, quoted } from '../index.ts';

const reasonFunction = { one: 'reason function', other: 'reason functions' };

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
    expect([capitalized('the reason function'), capitalized('“summary” is'), capitalized('')]).toEqual([
      'The reason function',
      '“summary” is',
      '',
    ]);
  });

  it('lists alternatives with or', () => {
    expect(alternatives(['reason function', 'workflow'])).toBe('reason function or workflow');
  });

  it.each([
    [0, '0 reason functions'],
    [1, '1 reason function'],
    [2, '2 reason functions'],
    [100, 'one hundred reason functions'],
  ])('counts %i as %s', (count, text) => {
    expect(counted(count, reasonFunction)).toBe(text);
  });
});

describe('a number in plain words', () => {
  it.each([
    [99, '99'],
    [100, 'one hundred'],
    [101, 'one hundred and one'],
    [115, 'one hundred and fifteen'],
    [240, 'two hundred and forty'],
    [342, 'three hundred and forty-two'],
    [599, 'five hundred and ninety-nine'],
    [600, '600'],
    [2.5, '2.5'],
  ])('writes %d in words only where digits could read as a status code, as %s', (number, words) => {
    expect(plainNumber(number)).toBe(words);
  });
});

describe('phrasing a sentence', () => {
  it.each([
    ['Summarizes a text', 'Summarizes a text.'],
    ['  Summarizes a text.  ', 'Summarizes a text.'],
    ['Is it done?', 'Is it done?'],
    ['Says “hi!”', 'Says “hi!”'],
  ])('makes %j a sentence', (text, sentence) => {
    expect(asSentence(text)).toBe(sentence);
  });
});
