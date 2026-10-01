import { describe, expect, it } from 'vitest';

import {
  entriesOf,
  field,
  isJson,
  isList,
  isObject,
  isTruthy,
  jsonBytesOf,
  jsonEquals,
  listField,
  objectField,
  textField,
} from './json.ts';

describe('reading JSON', () => {
  const value = { name: 'Ada', tags: ['a'], nested: { deep: true }, nothing: null };

  it('reads own fields only, by kind', () => {
    expect(field(value, 'name')).toBe('Ada');
    expect(field(value, 'toString')).toBeUndefined();
    expect(textField(value, 'name')).toBe('Ada');
    expect(textField(value, 'tags')).toBeUndefined();
    expect(objectField(value, 'nested')).toEqual({ deep: true });
    expect(objectField(value, 'nothing')).toBeUndefined();
    expect(listField(value, 'tags')).toEqual(['a']);
    expect(listField(value, 'name')).toBeUndefined();
    expect(entriesOf({ a: 1 })).toEqual([['a', 1]]);
  });

  it('tells objects from lists and null', () => {
    expect([isObject({}), isObject([]), isObject(null)]).toEqual([true, false, false]);
    expect([isList([]), isList({})]).toEqual([true, false]);
  });

  it('treats only null and false as false', () => {
    expect([null, false, 0, '', true, [], {}].map((item) => isTruthy(item))).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('comparing JSON', () => {
  it('compares lists item by item and objects key by key, in any key order', () => {
    expect(jsonEquals([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
    expect(jsonEquals([1, 2], [1])).toBe(false);
    expect(jsonEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(jsonEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEquals({ a: 1 }, { b: 1 })).toBe(false);
    expect(jsonEquals([1], { 0: 1 })).toBe(false);
    expect(jsonEquals('x', 'x')).toBe(true);
  });

  it('counts the bytes of JSON in UTF-8', () => {
    expect(jsonBytesOf({ name: 'é' })).toBe(13);
  });
});

describe('recognizing JSON', () => {
  it.each([null, 'a', true, 1.5, [1, [2]], { a: { b: null } }, Object.create(null)])('accepts %j', (value) => {
    expect(isJson(value)).toBe(true);
  });

  it('refuses numbers JSON cannot carry, and values that are not data', () => {
    expect(isJson(Number.NaN)).toBe(false);
    expect(isJson(Infinity)).toBe(false);
    expect(isJson([1, Number.NaN])).toBe(false);
    expect(isJson({ a: Number.NaN })).toBe(false);
    expect(isJson(new Date(0))).toBe(false);
    expect(isJson(Symbol('s'))).toBe(false);
  });
});
