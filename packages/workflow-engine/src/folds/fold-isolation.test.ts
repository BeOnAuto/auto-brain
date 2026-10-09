import { describe, expect, it } from 'vitest';

import type { Json } from '../dsl/json.ts';
import { folded, pageOf, viewOf } from '../pool-testing/fold-pages.ts';
import type { FoldStall } from './fold-page.ts';

interface Folding {
  readonly view: Json;
  readonly stall?: FoldStall;
}

const considered = [0, 2, 3];

async function inPagesOf(size: number, fold: string, view: Json, start = 0): Promise<Folding> {
  const events = considered.slice(start, start + size);
  if (events.length === 0) {
    return { view };
  }
  const [result] = (await folded(pageOf([viewOf(fold, { view, events })]))).views;
  return result?.stall === undefined
    ? inPagesOf(size, fold, result?.view ?? null, start + size)
    : { view: result.view, stall: result.stall };
}

function writingTo(holder: string): string {
  return [
    'export function fold(view: { counts: number[] }): { counts: number[] } {',
    `  const holder: any = ${holder};`,
    '  holder.seen = (holder.seen ?? 0) + 1;',
    '  return { counts: [...view.counts, holder.seen] };',
    '}',
  ].join('\n');
}

const holders: readonly (readonly [string, string])[] = [
  ['the prototype of array iterators', 'Object.getPrototypeOf([][Symbol.iterator]())'],
  ['the prototype of map iterators', 'Object.getPrototypeOf(new Map()[Symbol.iterator]())'],
  ['the prototype of set iterators', 'Object.getPrototypeOf(new Set()[Symbol.iterator]())'],
  ['the prototype of string iterators', 'Object.getPrototypeOf(""[Symbol.iterator]())'],
  ['the prototype of the iterators of matchAll', 'Object.getPrototypeOf("".matchAll(/x/g))'],
  ['the prototype of generator functions', 'Object.getPrototypeOf(function* () {})'],
  ['the prototype of generators', 'Object.getPrototypeOf(function* () {}).prototype'],
  ['the prototype of async generator functions', 'Object.getPrototypeOf(async function* () {})'],
  ['the prototype of async generators', 'Object.getPrototypeOf(async function* () {}).prototype'],
  ['the prototype of async functions', 'Object.getPrototypeOf(async function () {})'],
  ['the prototype of iterator helpers', 'Object.getPrototypeOf([].values().map((each) => each))'],
  [
    'the prototype of wrapped iterators',
    'Object.getPrototypeOf(Iterator.from({ next: () => ({ done: true, value: undefined }) }))',
  ],
];

describe('the intrinsics of a page that no global names', () => {
  it.each(holders)(
    'are frozen with the rest, so a fold that writes to %s stalls at its first event in pages of one and of three',
    async (_holder, holder) => {
      const fold = writingTo(holder);

      const [one, three] = [await inPagesOf(1, fold, { counts: [] }), await inPagesOf(3, fold, { counts: [] })];

      expect(three).toMatchObject({ view: { counts: [] }, stall: { at: 0, kind: 'raised' } });
      expect(one).toEqual(three);
    },
  );
});

describe('a fold in a frozen page', () => {
  it('still iterates with helpers, generators, matchAll and the iterators of a Map and a Set', async () => {
    const iterating = [
      'export function fold(view: number[]): number[] {',
      '  function* twice(values: number[]) {',
      '    for (const value of values) yield value * 2;',
      '  }',
      '  const doubled = [...twice([1, 2])];',
      '  const helped = [3, 4].values().map((value) => value + 1).toArray();',
      '  const matched = [..."a1b2".matchAll(/\\d/g)].map((found) => Number(found[0]));',
      '  const kept = [...new Map([[5, 6]]).values(), ...new Set([7])];',
      '  return [...view, doubled.length + helped.length + matched.length + kept.length];',
      '}',
    ].join('\n');

    expect([await inPagesOf(1, iterating, []), await inPagesOf(3, iterating, [])]).toEqual([
      { view: [8, 8, 8] },
      { view: [8, 8, 8] },
    ]);
  });
});
