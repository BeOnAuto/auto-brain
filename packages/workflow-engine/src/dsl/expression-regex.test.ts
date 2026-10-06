import { describe, expect, it } from 'vitest';

import { childTimeoutMs, evaluateInAChild, stoppedEvaluationOf } from '../testing/expressions-in-a-child.ts';
import { runExpression, type Evaluation } from './expressions.ts';
import type { Json } from './json.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const mostWork = 8_000_000;

const workPerCodepoint = 16;

const longestSubject = 200_000;

const largestCharge = workPerCodepoint * longestSubject;

const workOfARefusal = 200_000;

function run(source: string, data: Json, work = mostWork): Evaluation {
  return runExpression(source, data, {}, { now, mostWork: work });
}

describe('a regular expression', { timeout: 2 * childTimeoutMs }, () => {
  it('may compile to at most 4096 instructions', () => {
    expect(run('"a" | test("a{4093}")', null)).toMatchObject({ value: false });
    expect(run('try ("a" | test("a{4094}")) catch .', null)).toMatchObject({
      value: 'regex too large: more than 4096 instructions',
    });
  });

  it('names where an unknown POSIX class is, not the name the pattern, perhaps from input, gives it', () => {
    expect(run('try ("a" | test("[[:" + "x" * 1000 + ":]]")) catch .', null)).toMatchObject({
      value: 'unsupported regex feature: unknown POSIX class at position 1',
    });
  });

  it.each<readonly [string, Json]>([
    ['"a" | test("(((a{100}){100}){100}){40}")', null],
    ['"a" | test("((((a{100}){100}){100}){100}){40}")', null],
    ['.p as $p | "a" | test($p)', { p: '(((a{100}){100}){100}){40}' }],
    ['"a" | test("a{99999999999999999999}")', null],
  ])('%s is refused as soon as it compiles too large, before it is expanded', (source, data) => {
    const { ended, output } = evaluateInAChild(source, data, mostWork);

    expect(ended).toEqual({ status: 0, signal: null });
    const evaluation = stoppedEvaluationOf(output);
    expect(evaluation).toMatchObject({
      problem: `${source}: RuntimeError: regex too large: more than 4096 instructions`,
      exhausted: false,
    });
    expect(evaluation.work).toBeLessThan(workOfARefusal);
  });

  it.each([
    '"a" | test("(((?:){4000}){4000}){4000}")',
    'try ("a" | test("(?:){100000000}")) catch "caught"',
    '("a" * 100000) as $p | reduce range(1000) as $i (0; . + (try ("a" | test($p) | 1) catch 2))',
    `"a" * ${longestSubject} | test("(?:|){2000}b")`,
    '("b" * 100000) as $c | "a" * 100000 | test("[" + $c + "]")',
  ])('%s stops at the work budget, past it by at most one charge', (source) => {
    const { ended, output } = evaluateInAChild(source, null, mostWork);

    expect(ended).toEqual({ status: 0, signal: null });
    const evaluation = stoppedEvaluationOf(output);
    expect(evaluation).toMatchObject({
      problem: `${source}: LimitError: Work limit exceeded`,
      exhausted: true,
    });
    expect(evaluation.work).toBeLessThanOrEqual(mostWork + largestCharge);
  });
});

const keywords = [
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo',
  'sierra tango uniform victor whiskey xray yankee zulu amber basil cedar dune ember fjord glade heath isle jasper',
  'karst loam marsh nectar onyx pine quartz reef shale tundra umber vale willow yarrow zephyr acorn birch clover',
  'daisy elder fern gorse hazel iris',
]
  .join(' ')
  .split(' ');

const filler = 'the order was shipped to our customer after review and payment cleared'.split(' ');

const levels = ['INFO', 'WARN', 'ERROR', 'DEBUG'];

const hexDigits = '0123456789abcdef'.split('');

const draws = { state: 7 };

function draw(): number {
  draws.state = (draws.state * 1_103_515_245 + 12_345) % 2_147_483_648;
  return draws.state / 2_147_483_648;
}

function upTo(limit: number): number {
  return Math.floor(draw() * limit);
}

function pick(items: readonly string[]): string {
  return items[upTo(items.length)] ?? '';
}

function hex(length: number): string {
  return Array.from({ length }, () => pick(hexDigits)).join('');
}

function wordsFrom(items: readonly string[], count: number): string {
  return Array.from({ length: count }, () => pick(items)).join(' ');
}

function textOf(bytes: number, line: (index: number) => string): string {
  const lines: string[] = [];
  for (let index = 0, length = 0; length < bytes; index += 1) {
    lines.push(line(index));
    length += (lines.at(-1)?.length ?? 0) + 1;
  }
  return lines.join('\n').slice(0, bytes);
}

const textBytes = 100_000;

const logText = textOf(
  textBytes,
  (index) => `2026-10-0${1 + (index % 9)}T09:${10 + (index % 50)}:00Z ${pick(levels)} ${wordsFrom(keywords, 14)}`,
);

const proseText = textOf(textBytes, (index) => `${wordsFrom(filler, 16)} ${index % 2 === 0 ? pick(keywords) : ''}`);

const csvText = textOf(
  textBytes,
  (index) =>
    `${index},${pick(keywords)},${pick(keywords)},${upTo(100_000)},${hex(8)},${pick(levels)},${wordsFrom(keywords, 9)}`,
);

const lineParser = `^(?<id>\\d+),(?<first>[a-z]+),(?<second>[a-z]+),(?<amount>\\d+),(?<code>[0-9a-f]{8}),(?<level>INFO|WARN|ERROR|DEBUG),(?<note>[a-z ]*)$|^${Array.from({ length: 40 }, () => '([^,]*)').join(',')}$`;

const regexCorpus: ReadonlyArray<readonly [string, string, string]> = [
  [
    'URLs',
    '[match("https?://[A-Za-z0-9.-]+(/[A-Za-z0-9._~%/-]*)?(\\\\?[A-Za-z0-9=&]*)?"; "g")] | length',
    textOf(
      textBytes,
      () =>
        `${wordsFrom(filler, 5)} https://${pick(keywords)}.example.com/${pick(keywords)}/${hex(6)}?q=${pick(keywords)} ${wordsFrom(filler, 3)}`,
    ),
  ],
  [
    'ISO dates',
    '[match("\\\\d{4}-\\\\d{2}-\\\\d{2}"; "g")] | length',
    textOf(
      textBytes,
      (index) =>
        `${wordsFrom(filler, 6)} 20${10 + (index % 20)}-0${1 + (index % 9)}-${10 + (index % 18)} ${wordsFrom(filler, 4)}`,
    ),
  ],
  ['the levels of log lines', '[match("^\\\\S+ (?<level>[A-Z]+) "; "gm") | .captures[0].string] | length', logText],
  [
    'lines that are emails',
    '[split("\\n")[] | select(test("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\\\.[A-Za-z]{2,}$"))] | length',
    textOf(textBytes, (index) =>
      index % 3 === 0
        ? `${pick(keywords)}.${pick(keywords)}${index}@${pick(keywords)}.example.com`
        : wordsFrom(keywords, 16),
    ),
  ],
  [
    'lines that are IPv4 addresses',
    '[split("\\n")[] | select(test("^((25[0-5]|2[0-4]\\\\d|1?\\\\d?\\\\d)\\\\.){3}(25[0-5]|2[0-4]\\\\d|1?\\\\d?\\\\d)$"))] | length',
    textOf(textBytes, (index) =>
      index % 2 === 0 ? Array.from({ length: 4 }, () => upTo(256)).join('.') : wordsFrom(keywords, 16),
    ),
  ],
  [
    'UUIDs',
    '[match("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"; "g")] | length',
    textOf(
      textBytes,
      () => `${wordsFrom(filler, 4)} ${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)} ${wordsFrom(filler, 3)}`,
    ),
  ],
  [
    'amounts of money',
    '[match("\\\\$\\\\d{1,3}(,\\\\d{3})*(\\\\.\\\\d{2})?"; "g")] | length',
    textOf(
      textBytes,
      () =>
        `${wordsFrom(filler, 6)} $${upTo(1000)},${String(upTo(1000)).padStart(3, '0')}.${String(upTo(100)).padStart(2, '0')} ${wordsFrom(filler, 3)}`,
    ),
  ],
  [
    `a list of ${keywords.length} keywords`,
    `[match("\\\\b(${keywords.join('|')})\\\\b"; "g")] | length`,
    proseText.slice(0, 25_000),
  ],
  [
    `a line parser of ${lineParser.length} characters`,
    `[split("\\n")[] | capture(${JSON.stringify(lineParser)}) | .id] | length`,
    csvText.slice(0, 40_000),
  ],
  ['repeated spaces', '[match("\\\\s{2,}"; "g")] | length', proseText],
  ['words in any case', '[match("error|warn"; "gi")] | length', logText],
  ['a separator pattern', 'split(", *"; null) | length', csvText.replaceAll('\n', ', ')],
];

describe('an ordinary regular expression', () => {
  it.each(regexCorpus)('over generated text fits one expression: %s', (_pattern, source, input) => {
    const evaluation = run(source, input);

    expect(evaluation).toHaveProperty('value');
    expect(evaluation.work).toBeLessThanOrEqual(mostWork);
  });

  it('is compiled once in an evaluation, and again in the next', () => {
    const pattern = `^(${keywords.join('|')})$`;
    const source = `[.[] | select(test(${JSON.stringify(pattern)}))] | length`;
    const lines = Array.from({ length: 34 }, () => keywords).flat();

    const first = run(source, lines);

    expect(first).toMatchObject({ value: lines.length });
    expect(run(source, lines)).toStrictEqual(first);
    expect(first.work).toBeLessThan(lines.length * pattern.length * workPerCodepoint);
  });
});
