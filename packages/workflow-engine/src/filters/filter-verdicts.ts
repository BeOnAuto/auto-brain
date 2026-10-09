import { mostInputMs, testedOrRaised } from '../dsl/evaluation.ts';
import { enclosedBody, expressionStripping } from '../dsl/expressions.ts';
import { entriesOf, field, isTruthy, jsonEquals, type Json, type JsonEntry, type JsonObject } from '../dsl/json.ts';
import { caughtRaise } from '../dsl/raised-error.ts';
import { filterContextOf, type FilterContext, type FilterTest } from '../programs/kept-contexts.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { meterOf, type Meter } from '../runner/run-tables.ts';
import type { FilterVerdict, LiteralFilter } from './event-filter.ts';

export interface FilterSandbox {
  readonly instance: SandboxInstance;
  readonly clock: () => number;
  readonly now: number;
}

type PreparedAttribute =
  | { readonly name: string; readonly expected: Json }
  | { readonly name: string; readonly source: string; readonly test: FilterTest };

interface PreparedFilter {
  readonly reference: string;
  readonly attributes: readonly PreparedAttribute[];
}

interface Testing {
  readonly meter: Meter;
  readonly reference: string;
  readonly deadlineAt: number;
  readonly now: number;
}

function preparedOf(
  { reference, attributes }: Pick<LiteralFilter, 'reference' | 'attributes'>,
  define: FilterContext['define'],
): PreparedFilter {
  return {
    reference,
    attributes: entriesOf(attributes).map(([name, expected]: JsonEntry): PreparedAttribute => {
      const source = enclosedBody(expected);
      return source === undefined ? { name, expected } : { name, source, test: define(source) };
    }),
  };
}

function attributeHolds(attribute: PreparedAttribute, event: JsonObject, testing: Testing): boolean {
  const actual = field(event, attribute.name) ?? null;
  if ('expected' in attribute) {
    return jsonEquals(attribute.expected, actual);
  }
  const mostWork = testing.meter.allowance();
  const run = attribute.test(JSON.stringify(actual), {
    budget: mostWork,
    deadlineAt: testing.deadlineAt,
    moment: testing.now,
  });
  return isTruthy(testedOrRaised(attribute.source, run, testing, mostWork));
}

function filterVerdict(
  filter: PreparedFilter,
  event: JsonObject,
  testing: Omit<Testing, 'meter' | 'reference'>,
): FilterVerdict {
  const place: Testing = { ...testing, meter: meterOf(), reference: filter.reference };
  return caughtRaise<FilterVerdict>(
    () => filter.attributes.every((attribute) => attributeHolds(attribute, event, place)),
    (error) => ({ error }),
  );
}

export function filterVerdictsOf(
  filters: readonly Pick<LiteralFilter, 'reference' | 'attributes'>[],
  event: JsonObject,
  { instance, clock, now }: FilterSandbox,
): readonly FilterVerdict[] {
  const deadlineAt = clock() + mostInputMs;
  const context = filterContextOf(
    instance,
    { stackBytes: threadStackBytes, mostAnswerBytes: unitMemoryBytes, clock },
    { stripping: expressionStripping, evaluation: { budget: Number.POSITIVE_INFINITY, deadlineAt, moment: now } },
  );
  try {
    const prepared = filters.map((filter) => preparedOf(filter, context.define));
    context.freeze();
    return prepared.map((filter) => filterVerdict(filter, event, { deadlineAt, now }));
  } finally {
    context.close();
  }
}
