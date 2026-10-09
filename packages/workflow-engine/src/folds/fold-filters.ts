import { enclosedBody } from '../dsl/expressions.ts';
import { entriesOf, field, jsonEquals, type Json, type JsonEntry, type JsonObject } from '../dsl/json.ts';
import type { FilterContext, FilterTest } from '../programs/kept-contexts.ts';
import type { ProgramFailure, ProgramRun } from '../programs/program-run.ts';

type Expected = { readonly name: string; readonly value: Json } | { readonly name: string; readonly test: FilterTest };

export interface PreparedFilter {
  readonly expected: readonly Expected[];
}

export type Stopped = Extract<ProgramFailure, { readonly ran: 'exhausted' }>;

export type Matching = { readonly matched: boolean; readonly work: number } | { readonly stopped: Stopped };

export type RunTest = (test: FilterTest, actual: Json) => ProgramRun;

const falsy: ReadonlySet<string> = new Set(['null', 'false']);

function expectedOf([name, value]: JsonEntry, define: FilterContext['define']): Expected {
  const body = enclosedBody(value);
  return body === undefined ? { name, value } : { name, test: define(body) };
}

export function preparedFilters(
  filters: readonly JsonObject[],
  define: FilterContext['define'],
): readonly PreparedFilter[] {
  return filters
    .filter((filter) => typeof field(filter, 'type') === 'string')
    .map((filter) => ({ expected: entriesOf(filter).map((entry: JsonEntry) => expectedOf(entry, define)) }));
}

function attributeMatching(expected: Expected, event: JsonObject, runTest: RunTest): Matching {
  const actual = field(event, expected.name) ?? null;
  if ('value' in expected) {
    return { matched: jsonEquals(expected.value, actual), work: 0 };
  }
  const run = runTest(expected.test, actual);
  if (run.ran === 'exhausted') {
    return { stopped: run };
  }
  return { matched: run.ran === 'answered' && !falsy.has(run.text), work: run.work };
}

function filterMatching({ expected }: PreparedFilter, event: JsonObject, runTest: RunTest): Matching {
  let work = 0;
  for (const each of expected) {
    const matching = attributeMatching(each, event, runTest);
    if (!('matched' in matching) || !matching.matched) {
      return 'matched' in matching ? { matched: false, work: work + matching.work } : matching;
    }
    work += matching.work;
  }
  return { matched: true, work };
}

export function matchingOf(filters: readonly PreparedFilter[], event: JsonObject, runTest: RunTest): Matching {
  let work = 0;
  for (const filter of filters) {
    const matching = filterMatching(filter, event, runTest);
    if (!('matched' in matching) || matching.matched) {
      return 'matched' in matching ? { matched: true, work: work + matching.work } : matching;
    }
    work += matching.work;
  }
  return { matched: false, work };
}
