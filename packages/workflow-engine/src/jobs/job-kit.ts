import { boundedCacheOf, type BoundedCache } from '../dsl/bounded-cache.ts';
import { mostCompiledCharacters } from '../dsl/expressions.ts';
import type { Json, JsonObject } from '../dsl/json.ts';
import type { FoldAnswerData } from '../folds/fold-answer.ts';
import type { FoldHost, ViewCheck } from '../folds/fold-page.ts';
import { compileProgram, type CompiledProgram } from '../programs/program-compiling.ts';
import type { Dialect } from '../programs/program-dialect.ts';
import type { FoldJob } from './fold-messages.ts';
import { unchecked, type OutputCheck, type ProgramAnswerData, type ProgramHost } from './program-answer.ts';
import type { ProgramJob } from './program-messages.ts';

export interface ValueChecks {
  readonly output: (schema: Json) => OutputCheck;
  readonly view: (schema: JsonObject) => ViewCheck;
}

export type ProgramHandler = (request: ProgramJob, host: ProgramHost) => ProgramAnswerData;

export type FoldHandler = (request: FoldJob, host: FoldHost) => FoldAnswerData;

export interface JobHandlers {
  readonly program?: ProgramHandler;
  readonly fold?: FoldHandler;
  readonly checks?: ValueChecks;
}

export interface Kept {
  readonly compile: (source: string, dialect: Dialect) => CompiledProgram;
  readonly outputCheck: (schema: Json) => OutputCheck;
  readonly viewCheck: (schema: JsonObject) => ViewCheck;
}

const noViewSchemaChecked = 'This worker checks no view schema; a page whose views keep one names a worker that does';

function remembered<Value>(cache: BoundedCache<Value>, key: string, make: () => Value): Value {
  const known = cache.get(key);
  if (known !== undefined) {
    return known;
  }
  const made = make();
  cache.set(key, made);
  return made;
}

export function keptFor(checks: ValueChecks | undefined): Kept {
  const programs = boundedCacheOf<CompiledProgram>(mostCompiledCharacters);
  const outputs = boundedCacheOf<OutputCheck>(mostCompiledCharacters);
  const views = boundedCacheOf<ViewCheck>(mostCompiledCharacters);
  return {
    compile: (source, dialect) =>
      remembered(programs, `${JSON.stringify(dialect)}\n${source}`, () => compileProgram(source, dialect)),
    outputCheck: (schema) =>
      checks === undefined || schema === null
        ? unchecked
        : remembered(outputs, JSON.stringify(schema), () => checks.output(schema)),
    viewCheck: (schema) =>
      checks === undefined
        ? () => noViewSchemaChecked
        : remembered(views, JSON.stringify(schema), () => checks.view(schema)),
  };
}
