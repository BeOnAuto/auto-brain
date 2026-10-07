import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { liftedLimits } from '../program-pool/program-pool.ts';
import { compileProgram } from '../programs/program-compiling.ts';
import { matchingOf, preparedFilters, type Matching, type RunTest } from './fold-filters.ts';

const dialect = { refused: [{ name: 'now', why: 'reads the clock' }], variables: ['event'] };

const reviewed = { type: 'execution_succeeded', subject: 'inference/review-brief' };

function succeeded(verdict: Json): JsonObject {
  return { ...reviewed, source: '/executions/run', data: { output: { campaign: 'spring', verdict } } };
}

const runTest: RunTest = (test, actual) =>
  test.program.run(actual, { limits: liftedLimits(16_000_000), outputs: 'first' });

function matched(filters: readonly JsonObject[], event: JsonObject): Matching {
  return matchingOf(preparedFilters(filters, dialect, compileProgram), event, runTest);
}

function workOf(matching: Matching): number {
  return 'work' in matching ? matching.work : 0;
}

const rejected = [{ ...reviewed, data: '${ .output.verdict | ascii_upcase == "REJECT" }' }];

const unbound: unknown = expect.stringContaining('$x is not defined');

describe('the filters of a view', () => {
  it('match an event by its type, subject and data', () => {
    expect(matched(rejected, succeeded('reject'))).toMatchObject({ matched: true });
    expect(matched(rejected, succeeded('approve'))).toMatchObject({ matched: false });
  });

  it('leave out an event whose data the filter cannot test', () => {
    expect(matched(rejected, succeeded(7))).toMatchObject({ matched: false });
  });

  it('never match an event that lacks an attribute a filter names', () => {
    expect(matched([{ type: 'execution_succeeded', time: '2026-10-01T09:00:00Z' }], succeeded('reject'))).toEqual({
      matched: false,
      work: 0,
    });
  });

  it('never match by a filter that names no type', () => {
    expect(matched([{ subject: 'inference/review-brief' }], succeeded('reject'))).toEqual({ matched: false, work: 0 });
  });

  it('match when any one filter matches, counting the work of every test they ran', () => {
    const approved = { type: 'execution_succeeded', data: '${ .output.verdict == "approve" }' };

    const alone = matched(rejected, succeeded('reject'));
    const both = matched([approved, ...rejected], succeeded('reject'));

    expect(both).toMatchObject({ matched: true });
    expect(workOf(both)).toBeGreaterThan(workOf(alone));
  });

  it('answer the filter that does not compile, without running it', () => {
    expect(matched([{ type: 'execution_succeeded', data: '${ $x }' }], succeeded('reject'))).toMatchObject({
      refused: { issues: [{ detail: unbound }] },
    });
  });
});
