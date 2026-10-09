import type { Json } from '@beonauto/workflow-engine/dsl';

import { computationLimits } from '../src/run/run-bounds.ts';
import { formatted, millisecondsOf, runInThread } from './common.ts';

interface Construct {
  readonly name: string;
  readonly operation: string;
}

interface Timed {
  readonly name: string;
  readonly milliseconds: number;
  readonly work: number;
}

const numbers = Array.from({ length: 10_000 }, (_, index) => index);

const keyed = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [`k${index}`, index]));

const data: Json = {
  a: numbers,
  b: [...numbers],
  o: keyed,
  s: 'x'.repeat(200_000),
  r: 'a'.repeat(5000),
  f: Array.from({ length: 2000 }, (_, index) => [index]),
  m: [numbers.slice(0, 1000), ...Array.from({ length: 100 }, () => [])],
  j: JSON.stringify(numbers),
};

const constructs: readonly Construct[] = [
  { name: 'repeating a string', operation: '"x" * 200000' },
  { name: 'concatenating strings', operation: '.s + .s' },
  { name: 'concatenating arrays', operation: '.a + .a' },
  { name: 'subtracting arrays', operation: '.a - .b' },
  { name: 'merging objects', operation: '.o * .o' },
  { name: 'comparing values', operation: '.a == .b' },
  { name: 'encoding JSON', operation: '.a | tojson' },
  { name: 'decoding JSON', operation: '.j | fromjson' },
  { name: 'deleting a path', operation: 'del(.a[0])' },
  { name: 'updating an object', operation: '.o.k0 = 1' },
  { name: 'updating an array', operation: '.a[0] = 1' },
  { name: 'slicing', operation: '.a[1:] | .[0]' },
  { name: 'iterating', operation: '[.a[]] | length' },
  { name: 'reducing', operation: 'reduce .a[] as $x (0; . + $x)' },
  { name: 'formatting', operation: '.s | @base64' },
  { name: 'searching a string', operation: '.s | contains("y")' },
  { name: 'running the regex machine', operation: '.r | test("(a|a|a|a|a|a|a|a|a|a)*b")' },
  { name: 'reading text for a regex', operation: '.s | test("y")' },
  { name: 'substituting', operation: '.s | sub("x"; "z")' },
  { name: 'changing case', operation: '.s | ascii_upcase' },
  { name: 'splitting', operation: '.s | split("x")' },
  { name: 'exploding', operation: '.s | explode' },
  { name: 'joining', operation: '.a | map(tostring) | join(",")' },
  { name: 'sorting', operation: '.b | sort' },
  { name: 'grouping', operation: '.a | group_by(. % 10)' },
  { name: 'keeping unique values', operation: '.a | unique' },
  { name: 'flattening', operation: '.f | flatten' },
  { name: 'transposing', operation: '.m | transpose' },
  { name: 'listing entries', operation: '.o | to_entries' },
  { name: 'listing paths', operation: '[.o | paths] | length' },
  { name: 'hashing a long key', operation: '.o[.s + "k"]' },
  { name: 'stepping', operation: '1 + 1' },
];

function timed({ name, operation }: Construct): Timed {
  const source = `def operation: ${operation}; . as $d | reduce range(1000000000) as $i (0; . + ($d | operation | 0))`;
  const ran = { work: 0 };
  const milliseconds = millisecondsOf(() => {
    ran.work = runInThread(source, data, computationLimits).work;
  });
  return { name, milliseconds, work: ran.work };
}

export function constructsMeasured(): readonly string[] {
  const all = constructs.map((construct) => timed(construct));
  const slowest = all.toSorted((first, second) => second.milliseconds - first.milliseconds);
  return [
    `each of ${all.length} charged constructs, repeated until a run's ${formatted(computationLimits.mostWork)} units are spent, on the thread that measures:`,
    ...slowest.map(
      ({ name, milliseconds, work }) => `  ${name}: ${formatted(milliseconds)} ms for ${formatted(work)} units`,
    ),
  ];
}
