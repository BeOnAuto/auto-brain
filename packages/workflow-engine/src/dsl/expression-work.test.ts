import { describe, expect, it } from 'vitest';

import { runExpression, type Evaluation } from './expressions.ts';
import type { Json } from './json.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const mostWork = 8_000_000;

const numbers = Array.from({ length: 10_000 }, (_, index) => index);

const keyed: Json = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`k${index}`, index]));

const text = 'x'.repeat(200_000);

const capitals = 'X'.repeat(200_000);

const singles: Json = Array.from({ length: 2000 }, (_, index) => [index]);

const ragged: Json = [numbers, ...Array.from({ length: 100 }, () => [])];

const alternatives = Array.from({ length: 10 }, () => 'a').join('|');

function run(source: string, data: Json, work = mostWork): Evaluation {
  return runExpression(source, data, {}, { now, mostWork: work });
}

describe('the work of an expression', () => {
  it.each(['"x" * 100000000', 'reduce range(27) as $i ("x"; . + .)', '"x" * 40000000 | length'])(
    'stops %s once it has done the most an expression may',
    (source) => {
      const evaluation = run(source, null);

      expect(evaluation).toMatchObject({ problem: `${source}: LimitError: Work limit exceeded`, exhausted: true });
      expect(evaluation.work).toBeGreaterThan(mostWork);
    },
  );

  it('cannot be caught by try', () => {
    expect(run('try ("x" * 100000000) catch "caught"', null)).toMatchObject({ exhausted: true });
  });

  it('counts a value as often as it is shared, so doubling a shared value stops', () => {
    expect(run('reduce range(40) as $i (0; [., .])', null)).toMatchObject({
      problem: 'reduce range(40) as $i (0; [., .]): Work limit exceeded',
      exhausted: true,
    });
    expect(run('reduce range(40) as $i (0; [., .]) | tojson', null)).toMatchObject({ exhausted: true });
  });

  it('is reported for an expression that finishes', () => {
    expect(run('.a', { a: 1 })).toStrictEqual({ value: 1, work: 256 });
  });
});

describe('each operation that builds or visits values', () => {
  it.each<readonly [string, string, Json, number]>([
    ['repeats a string', '"x" * 200000', null, 100_000],
    ['concatenates strings', 'reduce range(20) as $i ("x"; . + .)', null, 100_000],
    ['concatenates arrays', '.a + .a', { a: numbers }, 100_000],
    ['subtracts arrays', '.a - .a', { a: numbers }, 100_000],
    ['merges objects', '.o * .o', { o: keyed }, 100_000],
    ['compares values', '.a == .b', { a: numbers, b: [...numbers] }, 100_000],
    ['encodes JSON', '.n | tojson', { n: [numbers] }, 100_000],
    ['deletes a path', 'del(.a[0])', { a: numbers }, 100_000],
    ['updates an object', '.o.k0 = 1', { o: keyed }, 100_000],
    ['updates an array', '.a[0] = 1', { a: numbers }, 100_000],
    ['pads an array', '.[100000000] = 1', null, 100_000],
    ['updates a slice', '.a[0:1] = []', { a: numbers }, 100_000],
    ['slices', '.a[1:] | .[0]', { a: numbers }, 100_000],
    ['iterates', 'first(.a[])', { a: numbers }, 100_000],
    ['formats', '.s | @base64', { s: text }, 100_000],
    ['takes a builtin input', '.s | length', { s: text }, 100_000],
    ['takes a builtin output', '[.a] | first', { a: numbers }, 100_000],
    ['searches a string', '.s | contains("y")', { s: text }, 500_000],
    ['runs the regex machine', '.s | test("(' + alternatives + ')*b")', { s: 'a'.repeat(5000) }, 500_000],
    ['reads codepoints for a regex', '.s | test("x")', { s: text }, 1_000_000],
    ['changes case', '.s | ascii_downcase', { s: capitals }, 1_000_000],
    ['changes case upward', '.s | ascii_upcase', { s: text }, 1_000_000],
    ['reads codepoints for a substitution', '.s | sub("x"; "z")', { s: text }, 1_000_000],
    ['flattens to a depth', '.f | flatten(1) | .[0]', { f: singles }, 1_000_000],
    ['transposes', '.m | transpose | .[0]', { m: ragged }, 1_000_000],
    ['flattens', '.f | flatten | .[0]', { f: singles }, 1_000_000],
    ['steps', 'reduce range(1000) as $i (0; . + 1)', null, 200_000],
    [
      'checks what is inside',
      '. as $d | .a | inside($d.b)',
      { a: numbers.slice(0, 2000), b: numbers.slice(0, 2000) },
      1_000_000,
    ],
  ])('charges the work when it %s', (_operation, source, data, work) => {
    expect(run(source, data, work)).toMatchObject({ exhausted: true });
  });
});

describe('searching a string for another', () => {
  it('finds what the engine finds, overlapping occurrences included', () => {
    expect(
      run('[split(","), index("cd"), rindex(","), indices(","), contains("cd"), (. / ","), contains("")]', 'ab,cd,ef'),
    ).toMatchObject({ value: [['ab', 'cd', 'ef'], 3, 5, [2, 5], true, ['ab', 'cd', 'ef'], true] });
    expect(
      run('[indices("aa"), split("aa"), rindex("aa"), index("aa"), index(""), rindex(""), indices("")]', 'aaaa'),
    ).toMatchObject({
      value: [[0, 1, 2], ['', '', ''], 2, 0, 0, 4, []],
    });
  });

  it('takes time linear in the lengths, where the engine takes their product', () => {
    expect(run('"a" * 400000 | rindex("a" * 100000 + "b")', null)).toMatchObject({ value: null });
  });
});

describe('an operation that allocates in proportion to its output', () => {
  it.each<readonly [string, string, number]>([
    ['explodes', '.s | explode', 3_400_528],
    ['splits', '.s | split("x")', 3_400_672],
    ['divides', '.s / "x"', 3_400_561],
  ])('charges what it %s before it allocates it', (_operation, source, work) => {
    expect(run(source, { s: text }, 1_000_000)).toMatchObject({ exhausted: true, work });
  });
});
