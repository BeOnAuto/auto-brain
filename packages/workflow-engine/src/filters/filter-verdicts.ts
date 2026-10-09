import { mostInputMs, testedOrRaised } from '../dsl/evaluation.ts';
import type { JsonObject } from '../dsl/json.ts';
import { caughtRaise } from '../dsl/raised-error.ts';
import { filterContextOf, type FilterContext, type FilterTest } from '../programs/kept-contexts.ts';
import { threadStackBytes, unitMemoryBytes } from '../programs/sandbox-bounds.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { meterOf, type Meter } from '../runner/run-tables.ts';
import { attributeHolds, filterAttributesOf, type FilterAttribute, type Verdict } from './attribute-match.ts';
import type { FilterVerdict, LiteralFilter } from './event-filter.ts';

export interface FilterSandbox {
  readonly instance: SandboxInstance;
  readonly clock: () => number;
  readonly now: number;
}

interface PreparedFilter {
  readonly reference: string;
  readonly attributes: readonly FilterAttribute<FilterTest>[];
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
  return { reference, attributes: filterAttributesOf(attributes, define) };
}

function verdictIn(testing: Testing): Verdict<FilterTest> {
  return (test, actual, source) => {
    const mostWork = testing.meter.allowance();
    const run = test(JSON.stringify(actual), { budget: mostWork, deadlineAt: testing.deadlineAt, moment: testing.now });
    return testedOrRaised(source, run, testing, mostWork);
  };
}

function filterVerdict(
  filter: PreparedFilter,
  event: JsonObject,
  testing: Omit<Testing, 'meter' | 'reference'>,
): FilterVerdict {
  const place: Testing = { ...testing, meter: meterOf(), reference: filter.reference };
  return caughtRaise<FilterVerdict>(
    () => filter.attributes.every((attribute) => attributeHolds(attribute, event, verdictIn(place))),
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
    { budget: Number.POSITIVE_INFINITY, deadlineAt, moment: now },
  );
  try {
    const prepared = filters.map((filter) => preparedOf(filter, context.define));
    context.freeze();
    return prepared.map((filter) => filterVerdict(filter, event, { deadlineAt, now }));
  } finally {
    context.close();
  }
}
