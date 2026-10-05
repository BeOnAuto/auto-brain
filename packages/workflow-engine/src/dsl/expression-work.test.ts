import { spawnSync } from 'node:child_process';

import { Schema } from 'effect';
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

const childTimeoutMs = 5000;

const timedEvaluation = [
  `import { runExpression } from ${JSON.stringify(new URL('./expressions.ts', import.meta.url).href)};`,
  'const [source, data] = process.argv.slice(1);',
  'const started = performance.now();',
  `const evaluation = runExpression(source, JSON.parse(data), {}, { now: 0, mostWork: ${mostWork} });`,
  'process.stdout.write(JSON.stringify({ evaluation, milliseconds: performance.now() - started }));',
].join('\n');

const TimedEvaluationSchema = Schema.Struct({
  evaluation: Schema.Struct({ problem: Schema.String, work: Schema.Number, exhausted: Schema.Boolean }),
  milliseconds: Schema.Number,
});

const decodeTimedEvaluation = Schema.decodeUnknownSync(Schema.fromJsonString(TimedEvaluationSchema));

interface ChildEvaluation {
  readonly ended: { readonly status: number | null; readonly signal: string | null };
  readonly timed: typeof TimedEvaluationSchema.Type | undefined;
}

function run(source: string, data: Json, work = mostWork): Evaluation {
  return runExpression(source, data, {}, { now, mostWork: work });
}

function runInAChild(source: string, data: Json = null): ChildEvaluation {
  const child = spawnSync(
    process.execPath,
    ['--max-old-space-size=256', '--input-type=module', '--eval', timedEvaluation, '--', source, JSON.stringify(data)],
    { encoding: 'utf8', timeout: childTimeoutMs, env: {} },
  );
  return {
    ended: { status: child.status, signal: child.signal },
    timed: child.status === 0 ? decodeTimedEvaluation(child.stdout) : undefined,
  };
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
    ['copies the capture slots of a regex', 'test("(" * 1000 + "a" + ")" * 1000)', 'b', 1_000_000],
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

describe('a regular expression', { timeout: 2 * childTimeoutMs }, () => {
  it('may compile to at most 4096 instructions', () => {
    expect(run('"a" | test("a{4093}")', null)).toMatchObject({ value: false });
    expect(run('try ("a" | test("a{4094}")) catch .', null)).toMatchObject({
      value: 'regex too large: more than 4096 instructions',
    });
  });

  it.each<readonly [string, Json]>([
    ['"a" | test("(((a{100}){100}){100}){40}")', null],
    ['"a" | test("((((a{100}){100}){100}){100}){40}")', null],
    ['.p as $p | "a" | test($p)', { p: '(((a{100}){100}){100}){40}' }],
    ['"a" | test("a{99999999999999999999}")', null],
  ])('%s is refused well within a second, as soon as it compiles too large', (source, data) => {
    const { ended, timed } = runInAChild(source, data);

    expect(ended).toEqual({ status: 0, signal: null });
    expect(timed?.evaluation).toMatchObject({
      problem: `${source}: RuntimeError: regex too large: more than 4096 instructions`,
      exhausted: false,
    });
    expect(timed?.milliseconds).toBeLessThan(500);
  });

  it.each([
    '"a" | test("(((?:){4000}){4000}){4000}")',
    'try ("a" | test("(?:){100000000}")) catch "caught"',
    '("a" * 100000) as $p | reduce range(1000) as $i (0; . + (try ("a" | test($p) | 1) catch 2))',
    '"a" * 200000 | test("(?:|){2000}b")',
    '("b" * 100000) as $c | "a" * 100000 | test("[" + $c + "]")',
  ])('%s stops at the work budget well within a second', (source) => {
    const { ended, timed } = runInAChild(source);

    expect(ended).toEqual({ status: 0, signal: null });
    expect(timed?.evaluation).toMatchObject({
      problem: `${source}: LimitError: Work limit exceeded`,
      exhausted: true,
    });
    expect(timed?.milliseconds).toBeLessThan(500);
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
    expect(elapsed).toBeLessThan(300);
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
