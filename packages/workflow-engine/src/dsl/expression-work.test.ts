import { describe, expect, it } from 'vitest';

import {
  childHeapMegabytes,
  childTimeoutMs,
  evaluateInAChild,
  stoppedEvaluationOf,
} from '../testing/expressions-in-a-child.ts';
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

const ropeLength = 4_000_000;

const workPerValue = 16;

const comparisonCharge = 2 * workPerValue + 'a'.length + ropeLength + 'x'.length;

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
    ['reads the codepoints of a regex', '.s as $p | "x" | test($p)', { s: text }, 1_000_000],
    ['compiles a regex', '"a" | test("(?:a{60}){60}")', null, 50_000],
    ['repeats a regex that compiles to nothing', '"a" | test("(?:){100000}")', null, 1_000_000],
    ['passes the regex machine through instructions', '.s | test("(?:|){2000}b")', { s: 'a'.repeat(1000) }, 1_000_000],
    ['copies the capture slots of a regex', 'test("(" * 1000 + "a" + ")" * 1000)', 'b'.repeat(10), 1_000_000],
    ['tests the members of a regex class', '.s | test("[" + "b" * 1000 + "]")', { s: 'a'.repeat(10_000) }, 1_000_000],
    ['prepares a regex search', '.s | gsub("x|(?:y{4000})"; "")', { s: 'x'.repeat(2000) }, 1_000_000],
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

  it.each<readonly [string, string, number]>([
    ['joins', '.a | join(",")', 1_000_740],
    ['formats as CSV', '.a | @csv', 16_002_048],
    ['formats as TSV', '.a | @tsv', 16_002_048],
    ['formats for the shell', '.a | @sh', 16_002_048],
  ])('charges the strings it %s before it builds them', (_operation, source, work) => {
    expect(run(source, { a: [text, text, text, text, text] }, 1_000_000)).toMatchObject({ exhausted: true, work });
  });

  it.each(['join("")', '@csv', '@tsv', '@sh'])(
    '%s of a hundred long strings stops before it builds them',
    { timeout: 2 * childTimeoutMs },
    (build) => {
      const source = `("ā" * ${ropeLength}) as $s | [range(100) | $s] | ${build}`;
      const { ended, output } = evaluateInAChild(source, null, mostWork);

      expect(ended).toEqual({ status: 0, signal: null });
      const evaluation = stoppedEvaluationOf(output);
      expect(evaluation).toMatchObject({ problem: `${source}: LimitError: Work limit exceeded`, exhausted: true });
      expect(evaluation.peakMegabytes).toBeLessThan(childHeapMegabytes);
    },
  );
});

describe('a string used as an object key', () => {
  it.each<readonly [string, string]>([
    ['indexes an object', '{} | .[$s + "x"]'],
    ['checks for a key', '{} | has($s + "x")'],
    ['builds an object', '{($s + "x"): 1} | length'],
    ['reads a path', '{} | getpath([$s + "x"])'],
    ['sets a path', '{} | setpath([$s + "x"]; 1) | length'],
    ['assigns to a key', '{} | .[$s + "x"] = 1 | length'],
    ['deletes a key', '{} | del(.[$s + "x"])'],
    ['makes an object of entries', '[{key: ($s + "x"), value: 1}] | from_entries | length'],
    ['indexes values by a key', '[$s + "x"] | INDEX(.) | length'],
  ])('is charged by its length when the expression %s', (_operation, use) => {
    expect(run(`.s as $s | ${use}`, { s: text }, 150_000)).toMatchObject({ exhausted: true });
  });

  it('stops a loop that hashes a long key, where the engine charged next to nothing for it', () => {
    const source = '("a" * 4000000) as $s | {} as $o | reduce range(1000) as $i (0; . + ($o[$s + "x"] // 1))';

    expect(run(source, null)).toMatchObject({ problem: `${source}: LimitError: Work limit exceeded`, exhausted: true });
  });
});

describe('comparing a short string with a long one', { timeout: 2 * childTimeoutMs }, () => {
  it.each<readonly [string, string]>([
    ['for equality', '"a" == ($s + "x") | 1'],
    ['for order', '"a" < ($s + "x") | 1'],
    ['in sort', '["a", $s + "x"] | sort | 1'],
    ['in sort, the other way round', '[$s + "x", "a"] | sort | 1'],
    ['in unique', '["a", $s + "x"] | unique | 1'],
    ['in group_by', '["a", $s + "x"] | group_by(.) | 1'],
    ['in min', '["a", $s + "x"] | min | 1'],
    ['in max', '["a", $s + "x"] | max | 1'],
  ])('charges both strings %s', (_comparison, use) => {
    expect(run(`("a" * 1000000) as $s | ${use}`, null, 1_500_000)).toMatchObject({ exhausted: true });
  });

  it.each([
    `("a" * ${ropeLength}) as $s | reduce range(1000) as $i (0; . + (if "a" < ($s + "x") then 1 else 0 end))`,
    `("a" * ${ropeLength}) as $s | reduce range(1000) as $i (0; . + ([$s + "x", "a"] | sort | length))`,
  ])('%s stops at the work budget, past it by at most one charge', (source) => {
    const { ended, output } = evaluateInAChild(source, null, mostWork);

    expect(ended).toEqual({ status: 0, signal: null });
    const evaluation = stoppedEvaluationOf(output);
    expect(evaluation).toMatchObject({ problem: `${source}: LimitError: Work limit exceeded`, exhausted: true });
    expect(evaluation.work).toBeLessThanOrEqual(mostWork + comparisonCharge);
  });
});

describe('the deadline of an expression', () => {
  it('stops an expression that runs past it, with the error the work budget stops it with', () => {
    const source = '("a" * 64000000) as $s | {} as $o | reduce range(1000) as $i (0; . + ($o[$s + "x"] // 1))';
    const deadline = { milliseconds: 200, clock: () => performance.now() };
    const started = performance.now();

    const evaluation = runExpression(source, null, {}, { now, mostWork: Number.MAX_SAFE_INTEGER, deadline });
    const elapsed = performance.now() - started;

    expect(evaluation).toMatchObject({ problem: `${source}: LimitError: Work limit exceeded`, exhausted: true });
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it('is read on the clock it is given, at most once in 4096 units of work', () => {
    const readings: number[] = [];
    const clock = (): number => {
      readings.push(readings.length);
      return readings.length;
    };

    const evaluation = run('[range(5000)] | length', null);
    const stopped = runExpression(
      '[range(5000)] | length',
      null,
      {},
      {
        now,
        mostWork,
        deadline: { milliseconds: 10, clock },
      },
    );

    expect(evaluation).toMatchObject({ value: 5000 });
    expect(stopped).toMatchObject({
      problem: '[range(5000)] | length: LimitError: Work limit exceeded',
      exhausted: true,
    });
    expect(readings).toHaveLength(11);
    expect(stopped.work).toBeGreaterThanOrEqual(9 * 4096);
    expect(stopped.work).toBeLessThan(evaluation.work);
  });
});
