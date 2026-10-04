import { describe, expect, it } from 'vitest';

import { retainedBytesOf } from './retained-size.ts';

describe('the bytes a value is estimated to keep in memory', () => {
  it('give a string two bytes a character, the widest V8 stores, and a header', () => {
    expect(retainedBytesOf('')).toBe(32);
    expect(retainedBytesOf('abc')).toBe(38);
  });

  it('give a number, a boolean and null the room of a boxed number', () => {
    expect([retainedBytesOf(1.5), retainedBytesOf(true), retainedBytesOf(null)]).toEqual([16, 16, 16]);
  });

  it('give a container its object, a slot per item or entry, and what each holds', () => {
    expect(retainedBytesOf([])).toBe(128);
    expect(retainedBytesOf([1, 'a'])).toBe(128 + 16 + 16 + 16 + 34);
    expect(retainedBytesOf({})).toBe(160);
    expect(retainedBytesOf({ a: 1 })).toBe(160 + 64 + 34 + 16);
  });

  it('count a part as often as it is shared, and remember a container it measured', () => {
    const part = { a: 1 };
    const shared = [part, part];

    expect(retainedBytesOf(shared)).toBe(128 + 2 * (16 + retainedBytesOf(part)));
    expect(retainedBytesOf(shared)).toBe(retainedBytesOf(shared));
  });
});
