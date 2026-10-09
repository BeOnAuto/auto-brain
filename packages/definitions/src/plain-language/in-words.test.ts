import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { inWords, wordsOf } from '../index.ts';

const renderings: ReadonlyArray<readonly [Schema.Json, string]> = [
  ['Profits rose.', '“Profits rose.”'],
  [42, '42'],
  [true, 'yes'],
  [false, 'no'],
  [null, 'nothing'],
  [[], 'an empty list'],
  [['a', 'b'], '“a” and “b”'],
  [{}, 'nothing'],
  [{ approve: true }, 'approve: yes'],
  [{ approve: true, reason: 'cheap' }, 'approve: yes and reason: “cheap”'],
  [
    { customer: { first_name: 'Ada' }, tags: [], extra: {} },
    'customer: (first name: “Ada”), tags: an empty list, and extra: nothing',
  ],
];

describe('inWords', () => {
  it.each(renderings)('renders %j as %s', (value, words) => {
    expect(inWords(value)).toBe(words);
  });

  it('gives up on a value too long to repeat in a sentence', () => {
    expect(inWords('a'.repeat(299))).toBeUndefined();
  });

  it('renders a value that just fits', () => {
    expect(inWords('a'.repeat(298))).toBe(`“${'a'.repeat(298)}”`);
  });
});

describe('wordsOf', () => {
  it.each([
    ['customer_name', 'customer name'],
    ['maxTokens', 'max tokens'],
    ['order-id', 'order id'],
    ['text', 'text'],
  ])('turns %s into %s', (name, words) => {
    expect(wordsOf(name)).toBe(words);
  });
});
