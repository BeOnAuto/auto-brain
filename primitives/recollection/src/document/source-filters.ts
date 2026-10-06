import { issueAt, type DocumentIssue, type SourceLines } from '@beonauto/specs/document';
import {
  compileProgram,
  enclosedBody,
  literalFilterOf,
  type LiteralFilterReading,
} from '@beonauto/workflow-engine/dsl';
import type { ViewFilter } from '@beonauto/workflow-host';
import { Predicate, Result, type Schema } from 'effect';

import { recallBounds } from '../run/recall-bounds.ts';
import { filterDialect } from './recall-dialects.ts';

type Checked<A> = Result.Result<A, readonly DocumentIssue[]>;

interface ReadFilter {
  readonly filter: ViewFilter;
}

interface RefusedFilter {
  readonly issues: readonly DocumentIssue[];
}

type FilterReading = ReadFilter | RefusedFilter;

type Rejection = Extract<LiteralFilterReading, { readonly rejections: unknown }>['rejections'][number];

const events = '/source/events';

const readsAVariable = 'data reads a variable, but a filter is matched over the event alone and is given none';

const notAMapping =
  'A filter is a mapping of the attributes an event must have: type, and optionally source, subject and data';

function isAttributes(filter: Schema.Json): filter is Schema.JsonObject {
  return Predicate.isObject(filter) && !Array.isArray(filter);
}

function compileIssues(data: Schema.Json | undefined, pointer: string, lines: SourceLines): readonly DocumentIssue[] {
  const body = enclosedBody(data);
  const compiled = body === undefined ? undefined : compileProgram(body, filterDialect);
  return compiled === undefined || 'program' in compiled
    ? []
    : compiled.issues.map(({ detail }) => issueAt(lines, `${pointer}/data`, detail));
}

function rejectionIssues(
  rejections: readonly Rejection[],
  compiling: readonly DocumentIssue[],
  pointer: string,
  lines: SourceLines,
): readonly DocumentIssue[] {
  const reportedByCompiling = compiling.length > 0 ? `${pointer}/with/data` : undefined;
  return [
    ...rejections
      .filter(({ pointer: at }) => at !== reportedByCompiling)
      .map(({ pointer: at, detail }) => issueAt(lines, at.replace(`${pointer}/with`, pointer), detail)),
    ...compiling,
  ];
}

function filterOf(filter: Schema.Json, index: number, lines: SourceLines): FilterReading {
  const pointer = `${events}/${index}`;
  if (!isAttributes(filter)) {
    return { issues: [issueAt(lines, pointer, notAMapping)] };
  }
  const reading = literalFilterOf({ with: filter }, pointer);
  const compiling = compileIssues(filter['data'], pointer, lines);
  if ('rejections' in reading) {
    return { issues: rejectionIssues(reading.rejections, compiling, pointer, lines) };
  }
  if (reading.filter.dataNeedsVariables) {
    return { issues: [issueAt(lines, `${pointer}/data`, readsAVariable)] };
  }
  return compiling.length > 0
    ? { issues: compiling }
    : { filter: { ...reading.filter.attributes, type: reading.filter.type } };
}

function isRefused(reading: FilterReading): reading is RefusedFilter {
  return 'issues' in reading;
}

function isRead(reading: FilterReading): reading is ReadFilter {
  return 'filter' in reading;
}

function countIssues(filters: readonly Schema.Json[], lines: SourceLines): readonly DocumentIssue[] {
  if (filters.length === 0) {
    return [issueAt(lines, events, 'A recall function folds the events at least one filter names; it names none')];
  }
  return filters.length > recallBounds.mostFilters
    ? [
        issueAt(
          lines,
          events,
          `A recall function takes at most ${recallBounds.mostFilters} filters; it names ${filters.length}`,
        ),
      ]
    : [];
}

export function filtersOf(filters: readonly Schema.Json[], lines: SourceLines): Checked<readonly ViewFilter[]> {
  const readings = filters.map((filter, index) => filterOf(filter, index, lines));
  const issues = [
    ...countIssues(filters, lines),
    ...readings.filter((reading) => isRefused(reading)).flatMap((refused) => refused.issues),
  ];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.succeed(readings.filter((reading) => isRead(reading)).map((read) => read.filter));
}
