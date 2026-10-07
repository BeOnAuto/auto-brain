import { enclosedBody } from '../dsl/expressions.ts';
import { entriesOf, field, isTruthy, jsonEquals, type Json, type JsonEntry, type JsonObject } from '../dsl/json.ts';
import type { CompiledProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { ProgramRun } from '../programs/program-running.ts';

export type Compile = (source: string, dialect: Dialect) => CompiledProgram;

type Expected =
  | { readonly name: string; readonly value: Json }
  | { readonly name: string; readonly test: CompiledProgram };

export interface PreparedFilter {
  readonly expected: readonly Expected[];
}

type Exhausted = Extract<ProgramRun, { readonly ran: 'exhausted' }>;

export type Matching =
  | { readonly matched: boolean; readonly work: number }
  | { readonly exhausted: Exhausted; readonly work: number }
  | { readonly refused: Extract<CompiledProgram, { readonly issues: unknown }> };

export type RunTest = (test: Extract<CompiledProgram, { readonly program: unknown }>, actual: Json) => ProgramRun;

function expectedOf([name, value]: JsonEntry, dialect: Dialect, compile: Compile): Expected {
  const body = enclosedBody(value);
  return body === undefined ? { name, value } : { name, test: compile(body, dialect) };
}

export function preparedFilters(
  filters: readonly JsonObject[],
  dialect: Dialect,
  compile: Compile,
): readonly PreparedFilter[] {
  const tests: Dialect = { refused: dialect.refused, variables: [] };
  return filters
    .filter((filter) => typeof field(filter, 'type') === 'string')
    .map((filter) => ({ expected: entriesOf(filter).map((entry: JsonEntry) => expectedOf(entry, tests, compile)) }));
}

function attributeMatching(expected: Expected, event: JsonObject, runTest: RunTest): Matching {
  const actual = field(event, expected.name) ?? null;
  if ('value' in expected) {
    return { matched: jsonEquals(expected.value, actual), work: 0 };
  }
  if ('issues' in expected.test) {
    return { refused: expected.test };
  }
  const run = runTest(expected.test, actual);
  if (run.ran === 'exhausted') {
    return { exhausted: run, work: run.work };
  }
  return { matched: run.ran === 'answered' && isTruthy(run.value), work: run.work };
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
